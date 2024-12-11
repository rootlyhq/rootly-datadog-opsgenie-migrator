# Rootly Datadog Opsgenie Migrator

Appends `@webhook-rootly-[serviceName]` to every Datadog monitor containing `@opsgenie-[serviceName]`, creating webhooks as necessary. Services are matched by name.

## Requirements

- Node.js and Yarn
- `DD_API_KEY`, `DD_APP_KEY`, `OPSGENIE_API_TOKEN`, and `ROOTLY_API_TOKEN` environment variables with the necessary permissions to read and update Datadog monitors, create Datadog webhooks, read Opsgenie services, and read Rootly services.
- A configured Rootly alert source for Datadog. Set `ROOTLY_ALERT_SOURCE_SECRET` to the alert source secret. This is used to verify webhooks from Datadog.
- Matching Opsgenie services must exist in Rootly and be linked to Opsgenie (the Rootly service `opsgenie_id` attribute must be set). You can link services to Opsgenie on the integrations tab when configuring your Rootly service.
- Services must have matching normalized names. A normalized name is one where all characters except A-z, 0-9, underscores, and dashes are replaced with an underscore. Matching is case-insensitive. For example, a Datadog mention `@opsgenie-production_on-call` will match a Opsgenie service named `[Production] On-Call` or `Production on-call`.

## Usage

    yarn install
    node index.js
