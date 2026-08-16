#!/usr/bin/env node
import { classifyTask } from './classifier.mjs'

const text = process.argv.slice(2).join(' ')
if (!text) {
  console.error('usage: npm run classify -- "task description"')
  process.exitCode = 2
} else {
  console.log(JSON.stringify(classifyTask(text), null, 2))
}
