'use strict'

const util = require('util')
const path = require('path')
const fs = require('fs')

const Digraph = require('./Digraph')

class ProjectExplorer {
  constructor(options) {
    this.options = options || {}
    this.account = this.options.account || ''
    this.rootPath = path.resolve(this.options.rootPath || path.resolve(process.env.PWD, '..'))
  }

  async listProjects() {
    const readdirAsync = util.promisify(fs.readdir)
    let projects = await readdirAsync(this.rootPath).filter( async(file) => {
      let projectPath = path.join(this.rootPath, file, 'package.json')
      try {
        const statAsync = util.promisify(fs.stat)
        let stat = await statAsync(projectPath)
        return stat.isFile()
      } catch (e) {
        return false
      }
    })
    return projects.reduce( (result, project) => {
      result[project] = path.join(this.rootPath, project)
      return result
    }, {})
  }

  async buildProjectGraph() {
    const graph = new Digraph()
    const mapping = {}
    let projects = await this.listProjects()
    Object.values(projects).map( (folder) => {
      return path.join(folder, 'package.json')
    })
      .forEach( (file) => {
        let packageDetail = require(file)
        if (this.account && packageDetail.name.startsWith(`${this.account}/`)) {
          mapping[packageDetail.name] = file
          graph.addVertex(packageDetail.name)
          if (packageDetail.dependencies) {
            Object.keys(packageDetail.dependencies).forEach( (dependency) => {
              if (dependency.startsWith(`${this.account}/`)) {
                graph.addEdge(packageDetail.name, dependency)
              }
            })
          }
        } else if (!this.account) {
          mapping[packageDetail.name] = file
          graph.addVertex(packageDetail.name)
          if (packageDetail.dependencies) {
            Object.keys(packageDetail.dependencies).forEach( (dependency) => {
              if (projects[dependency]) {
                graph.addEdge(packageDetail.name, dependency)
              }
            })
          }
        }
      })
    return { graph, mapping }
  }

  async orderedProjectCommands(command) {
    const { graph, mapping } = await this.buildProjectGraph()
    let topologicalOrder = []
    try {
      topologicalOrder = graph.topologicalSort()
      return topologicalOrder.filter( (key) => {
        return !!mapping[key]
      })
        .map( (key) => {
          let file = mapping[key]
          let projectPath = path.dirname(file)
          let dependencies = graph.adjacentList(key)
          return command({ projectPath, dependencies })
        })
    } catch (e) {
      throw new Error('Cannot create a topological sort from dependency graph')
    }
  }

  treeView(graph) {
    let prefix = this.options.prefix || ''
    let model = { nodes: [] }

    graph.topologicalSort().forEach( (u) => {
      let _node = {}
      _node.label = u
      _node.nodes = []
      graph.adjacentList(u).forEach( (w) => {
        _node.nodes.push(w)
      })
      model.nodes.push(_node)
    })
    return this.buildTree(model, prefix)
  }

  buildTree(model, prefix) {
    model = typeof model === 'string' ? { label: model } : model
    let nodes = model.nodes || []
    let lines = (model.label || '').split('\n')
    let splitter = '\n' + prefix + (nodes.length ? '│ ' : '  ')

    return prefix
      + lines.join(splitter) + '\n'
      + nodes.map( (node, index) => {
        let last = index === nodes.length - 1
        let more = node.nodes && node.nodes.length > 0
        let _prefix = prefix + (last ? '  ' : '│ ')

        return prefix + (last ? '└─' : '├─') + (more ? '┬ ' : '─ ')
              + this.buildTree(node, _prefix).slice(prefix.length + 2)
      }).join('')
  }

}

module.exports = ProjectExplorer