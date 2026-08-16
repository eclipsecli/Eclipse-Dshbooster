#!/usr/bin/env node
import fs from 'node:fs'
import { classifyTask } from '../src/classifier.mjs'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/evaluate.mjs <tasks.jsonl>')
  process.exit(2)
}

const rows = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
  try { return JSON.parse(line) } catch (error) { throw new Error(`${path}:${index + 1}: ${error.message}`) }
})

let correct = 0
let abstained = 0
const mistakes = []
const matrix = {}
for (const row of rows) {
  const output = classifyTask(row.text)
  const predicted = output.label
  matrix[row.expected] ??= {}
  matrix[row.expected][predicted] = (matrix[row.expected][predicted] ?? 0) + 1
  if (predicted === row.expected) correct += 1
  else mistakes.push({ text: row.text, expected: row.expected, predicted, mode: output.mode, reason: output.reason })
  if (output.abstain) abstained += 1
}

console.log(JSON.stringify({
  corpus: path,
  cases: rows.length,
  correct,
  accuracy: rows.length ? Number((correct / rows.length).toFixed(3)) : 0,
  abstained,
  abstainRate: rows.length ? Number((abstained / rows.length).toFixed(3)) : 0,
  matrix,
  mistakes
}, null, 2))

if (mistakes.length) process.exitCode = 1
