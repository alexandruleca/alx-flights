# ALX Flights — live ops board

**Docs: https://alexandruleca.github.io/alx-flights/** — the architecture with diagrams, what
the realistic feed does, decisions and trade-offs, tests, next steps, time and AI usage. The page's source is [`docs/index.html`](docs/index.html).

A small slice of an airport operations board for **ALX (AirportLabs Field)**. An ingest worker
consumes the live NDJSON feed and keeps a truthful picture of the airport in MongoDB. An API
mirrors it through change streams and pushes it to a Next.js desk: arrivals and departures, a
live map, alerts and KPIs, live or at any past instant.

## Run it

Start Docker (Rancher Desktop / Docker Desktop), then one command:

```bash
docker compose up -d
```

This starts Mongo (a single-node replica set, needed for change streams), installs
dependencies once, and runs **ingest**, **API** and **web** in dev mode with hot reload.

| | URL |
|---|---|
| Live desk | http://localhost:3000 |
| Replay | http://localhost:3000/replay |
| API health | http://localhost:3001/health |
| Mongo Express | http://localhost:8081 |

**Pointing it at another feed.** The feed URL is configuration, never code:

```bash
FEED_URL=https://<feed-host>/realistic/ndjson docker compose up -d   # shell wins
# or: cp .env.example .env, edit FEED_URL, then: docker compose restart ingest
```

If a feed's `hello` names a different airport than `AIRPORT_CODE` (default `ALX`), the feed
is **locked out**. Ingest ignores it and the desk shows a "feed misconfigured" banner,
rather than a plausible-looking board for the wrong airport.

```bash
npm test                          # domain + KPI store tests (vitest), on the host
npm run truth-check               # does the board match the feed right now?
docker compose logs -f ingest api
docker compose down -v            # stop and wipe the database
```

`npm test` needs no running stack; its store tests start a throwaway MongoDB 7, downloaded
once. `npm run truth-check` needs the stack up: it compares what the API serves with the
clean feed and exits non-zero on a real mismatch.

To run the apps on the host instead, start only `docker compose up -d mongo mongo-express`,
then `npm install` and `npm run dev:ingest`, `npm run dev:api`, `npm run dev:web` (host tools
use `MONGODB_URI=mongodb://127.0.0.1:27017/alx?replicaSet=rs0`).

## In the docs

- [Architecture](https://alexandruleca.github.io/alx-flights/#path), [the data model](https://alexandruleca.github.io/alx-flights/#data) and [how a change reaches the screen](https://alexandruleca.github.io/alx-flights/#live)
- [What the realistic feed does](https://alexandruleca.github.io/alx-flights/#feed) and how each behaviour is handled
- [Decisions and trade-offs](https://alexandruleca.github.io/alx-flights/#decisions)
- [Extras, and why](https://alexandruleca.github.io/alx-flights/#extras)
- [What is tested, and why](https://alexandruleca.github.io/alx-flights/#tests)
- [With two more days](https://alexandruleca.github.io/alx-flights/#next)
- [Time and AI usage](https://alexandruleca.github.io/alx-flights/#ai)
