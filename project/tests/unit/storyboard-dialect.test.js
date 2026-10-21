/**
 * The storyboard engine reads each scenario's sentences, with their
 * `# Chapter:`, `# Note:` and `# Copy:` comments, from the .feature file. It
 * only knew the English keywords: a scenario written under `# language: fr`
 * ran and kept its captures, but the engine read zero sentences from it, so
 * every note, chapter and copyable command was lost (issue #254).
 *
 * This test hands parseScenarioLines the same scenario in English and in
 * French and expects the same sentences, notes, chapters and copy lines, each
 * French sentence keeping its own keyword. Run in the suite's container:
 *
 *   node --test project/tests/unit/storyboard-dialect.test.js
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { parseScenarioLines } = require('../../../.config/codeceptjs/storyboard')

const ENGLISH = `Feature: Sign in
  Scenario: A teacher signs in with the school account
    # Chapter: The sign-in page
    # Note: The page offers the school account.
    # Copy: open https://example.org/login
    Given the sign-in page offers the school account
    # Note: The account opens the home page.
    When the teacher signs in with it
    And the home page greets the teacher
    Then the teacher sees the classes
`

const FRENCH = `# language: fr
Fonctionnalité: Connexion
  Scénario: Une enseignante se connecte avec le compte de l'établissement
    # Chapter: La page de connexion
    # Note: La page propose le compte de l'établissement.
    # Copy: open https://example.org/login
    Soit la page de connexion qui propose le compte de l'établissement
    # Note: Le compte ouvre la page d'accueil.
    Lorsqu'elle se connecte avec ce compte
    Et que la page d'accueil la salue
    Alors elle voit ses classes
`

function parse (source, title) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'storyboard-dialect-'))
  const file = path.join(dir, 'sign-in.feature')
  fs.writeFileSync(file, source)
  try {
    return parseScenarioLines(file, title)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const shape = (lines) => lines.map(({ group, chapter, note, copy }) => ({ group, chapter, note, copy }))

test('@storyboard-dialect the engine reads a French scenario as it reads the English one', () => {
  const english = parse(ENGLISH, 'A teacher signs in with the school account')
  const french = parse(FRENCH, "Une enseignante se connecte avec le compte de l'établissement")

  assert.equal(english.length, 4, 'The English scenario has four sentences')
  assert.equal(french.length, 4, 'The French scenario must have the same four sentences')
  assert.deepEqual(french.map(line => line.keyword), ['Soit', "Lorsqu'", 'Et que', 'Alors'], 'Each sentence keeps its own keyword')
  assert.deepEqual(french.map(line => line.text), [
    "la page de connexion qui propose le compte de l'établissement",
    'elle se connecte avec ce compte',
    "la page d'accueil la salue",
    'elle voit ses classes'
  ])
  assert.deepEqual(shape(french).map(line => line.group), shape(english).map(line => line.group), 'The same Given/When/Then groups')
  assert.deepEqual(shape(french).map(line => [!!line.chapter, !!line.note, !!line.copy]),
    shape(english).map(line => [!!line.chapter, !!line.note, !!line.copy]), 'The same chapters, notes and copy lines')
  assert.equal(french[0].copy, 'open https://example.org/login')
})
