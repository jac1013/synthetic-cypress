const cypress = require('cypress')
const serveIndex = require('serve-index')
const express = require('express')
const promBundle = require('express-prom-bundle')
const client = require('prom-client')
const { merge } = require('mochawesome-merge')
const generator = require('mochawesome-report-generator')
const fileSystem = require('fs-extra')

// Config to be set via environment variables
const SLEEP_MINS = process.env.SLEEP_MINS || 5
const SPECS_REGEX = process.env.SPECS_REGEX || '/cypress/e2e/*.cy.js'
const PORT = process.env.PORT || 3000
console.log('config', { SLEEP_MINS, SPECS_REGEX, PORT })

const app = express()

// Custom Prometheus gauges
const scenarioStatusGauge = new client.Gauge({
  name: 'scenario_status',
  help: 'Indicates if the tests are passing(1), failing(-1) or not run(0)',
  labelNames: ['scenario'],
})
const scenarioTimingGuage = new client.Gauge({
  name: 'scenario_timing',
  help: 'How long a scenario took to run in miliseconds',
  labelNames: ['scenario'],
})
app.use(promBundle({ includeMethod: true }))

// Store the app state in a global variable
let CURRENT_SUMMARY = { runs: [] }

// Add express routes for exposing artifacts
app.get('/', (req, res) => {
  res.setHeader('content-type', 'application/json')
  const baseUrl = req.protocol + '://' + req.get('Host')
  const result = summaryAsJson(CURRENT_SUMMARY, baseUrl)
  res.send(JSON.stringify(result, null, 4))
})
app.use('/videos', serveIndex(__dirname + '/cypress/videos'))
app.use('/videos', express.static(__dirname + '/cypress/videos'))
app.use('/screenshots', serveIndex(__dirname + '/cypress/screenshots'))
app.use('/screenshots', express.static(__dirname + '/cypress/screenshots'))
app.use('/status', serveIndex(__dirname + '/mochawesome-report'))
app.use('/status', express.static(__dirname + '/mochawesome-report'))
app.use('/health', require('express-healthcheck')())
app.use('/test-suite-health', (req, res) => {
  if (CURRENT_SUMMARY.totalFailed > 0) {
    return res.status(500).send('Failed');
  }
  return res.status(200).send('OK');
})
app.listen(PORT, () => {
  console.log(`Synthetic Cypress listening at http://localhost:${PORT}`)
})

// TODO: Improve to run in multiple type of browsers and be able to report for each type.
const runCypressTests = () => {
  return cypress.run({
    config: {
      video: true,
    },
    spec: __dirname + SPECS_REGEX,
  })
}

const generateHtmlReportWithMochawesome = () => {
  return fileSystem
    .remove('mochawesome-report')
    .then(() => merge({ files: [__dirname + '/cypress/results/*.json'] }))
    .then((r) => generator.create(r))
}

const updatePrometheusGauges = (results) => {
  let allPassing = true

  results.runs.forEach((run) => {
    run.tests.forEach((test) => {
      const title = test.title.join(' | ')
      const duration = test.attempts[0].duration
      let state = 0
      if (test.state === 'passed') state = 1
      if (test.state === 'failed') state = -1
      if (test.state === 'failed') allPassing = false

      scenarioStatusGauge.set({ scenario: title }, state)
      scenarioTimingGuage.set({ scenario: title }, duration)
    })
  })

  scenarioStatusGauge.set({ scenario: 'rollup' }, allPassing ? 1 : -1)
}

const summaryAsJson = (results, baseUrl) => {
  const tests = []
  if (results.runs) {
    results.runs.forEach((run) => {
      const videoLink = baseUrl + '/videos/' + run.video.split('/').slice(-1)[0]

      run.tests.forEach((test) => {
        const title = test.title.join(' | ')
        const state = test.state
        tests.push({ title, state, videoLink })
      })
    })
  }

  return {
    lastRun: {
      startedTestsAt: CURRENT_SUMMARY.startedTestsAt,
      endedTestsAt: CURRENT_SUMMARY.endedTestsAt,
      totalDuration: CURRENT_SUMMARY.totalDuration,
      totalSuites: CURRENT_SUMMARY.totalSuites,
      totalTests: CURRENT_SUMMARY.totalTests,
      totalFailed: CURRENT_SUMMARY.totalFailed,
      totalPassed: CURRENT_SUMMARY.totalPassed,
      totalPending: CURRENT_SUMMARY.totalPending,
      totalSkipped: CURRENT_SUMMARY.totalSkipped,
      tests,
    },
    statusPageLink: baseUrl + '/status/mochawesome.html',
    videosLink: baseUrl + '/videos',
    screenshotsLink: baseUrl + '/screenshots',
    metricsLink: baseUrl + '/metrics',
    serviceHealthCheck: baseUrl + '/health',
    testSuiteHealthCheck: baseUrl + '/test-suite-health',
  }
}

function sleep(mins) {
  return new Promise((resolve) => {
    setTimeout(resolve, 1000 * 60 * mins)
  })
}

async function runCypressInALoop() {
  while (true) {
    console.log('Running tests...')

    await fileSystem
      .remove(__dirname + '/cypress/results')
      .then(() => runCypressTests())
      .then((summary) => (CURRENT_SUMMARY = summary))
      .then(() => generateHtmlReportWithMochawesome())
      .then(() => updatePrometheusGauges(CURRENT_SUMMARY))

    // You could add Slack or other notifications here

    await sleep(SLEEP_MINS)
  }
}

runCypressInALoop()
