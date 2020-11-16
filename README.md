# Synthetic Cypress

> Run Cypress via cron inside a http service

Run with `node e2e-tests.js` which starts a service on port 3000 (or try it with Docker).

## What does this do?

It runs a Cypress test suite every minute and records the results to http://localhost:3000

You can see a detailed breakdown at http://localhost:3000/debug

And videos from the test runs at: http://localhost:3000/videos

## Running inside Docker

```sh
docker build --tag sycy .
docker run -p 3000:3000 sycy
```
