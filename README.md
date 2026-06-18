# Rootly Datadog Opsgenie Migrator

Appends `@webhook-rootly-[serviceName]` to every Datadog monitor containing `@opsgenie-[serviceName]`, creating webhooks as necessary. Services are matched by name.

## Requirements

- Node.js >= 24
- `DATADOG_API_KEY`, `DATADOG_APP_KEY`, `OPSGENIE_API_TOKEN`, and `ROOTLY_API_TOKEN` environment variables with the necessary permissions to read and update Datadog monitors, create Datadog webhooks, read Opsgenie services, and read Rootly services.
- A configured Rootly alert source for Datadog. Set `ROOTLY_ALERT_SOURCE_SECRET` to the alert source secret. This is used to verify webhooks from Datadog.
- Matching Opsgenie services must exist in Rootly and be linked to Opsgenie (the Rootly service `opsgenie_id` attribute must be set). You can link services to Opsgenie on the integrations tab when configuring your Rootly service.
- Services must have matching normalized names. A normalized name is one where all characters except A-z, 0-9, underscores, and dashes are replaced with an underscore. Matching is case-insensitive. For example, a Datadog mention `@opsgenie-production_on-call` will match an Opsgenie service named `[Production] On-Call` or `Production on-call`.

## Setup

```bash
cp .env.example .env
# Fill in your credentials in .env
```

## Usage

```bash
yarn install
yarn start
```

Set `DRY_RUN=1` in `.env` to preview changes without modifying any monitors or creating webhooks.

## Development

```bash
yarn lint
yarn test
```
