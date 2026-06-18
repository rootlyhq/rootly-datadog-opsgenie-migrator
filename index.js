const fs = require('fs');

if (require.main === module) {
  const requiredEnvVars = ['DATADOG_API_KEY', 'DATADOG_APP_KEY', 'OPSGENIE_API_TOKEN', 'ROOTLY_API_TOKEN', 'ROOTLY_ALERT_SOURCE_SECRET'];
  requiredEnvVars.forEach(envVar => {
    if (!process.env[envVar]) {
      console.error(`Missing environment variable: ${envVar}`);
      process.exit(1);
    }
  });
}

const DATADOG_API_KEY = process.env.DATADOG_API_KEY;
const DATADOG_APP_KEY = process.env.DATADOG_APP_KEY;
const OPSGENIE_API_TOKEN = process.env.OPSGENIE_API_TOKEN;
const ROOTLY_API_TOKEN = process.env.ROOTLY_API_TOKEN;
const ROOTLY_ALERT_SOURCE_SECRET = process.env.ROOTLY_ALERT_SOURCE_SECRET;

const DATADOG_API_URL = 'https://api.datadoghq.com/api/v1';
const OPSGENIE_API_URL = 'https://api.opsgenie.com';
const ROOTLY_API_URL = process.env.ROOTLY_API_URL || 'https://api.rootly.com/v1';
const TIMEOUT = 5000;

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const results = [];

let opsgenieServicesCache = [];
let rootlyServicesCache = [];

async function fetchJSON(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
      error.status = response.status;
      error.data = body;
      throw error;
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  try {
    console.log('Starting process...');

    await fetchAndCacheRootlyServices();
    await fetchAndCacheOpsgenieServices();

    const monitors = await fetchDatadogMonitors();

    console.log(`Found ${monitors.length} monitors.`);
    for (const monitor of monitors) {
      await processMonitor(monitor);
    }

    console.log('Process completed.');
    fs.writeFileSync(`run-${Date.now()}.csv`, resultsCSV());
  } catch (err) {
    console.error('An error occurred:', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

async function fetchAndCacheOpsgenieServices() {
  console.log('Fetching and caching Opsgenie services...');
  let services = [];
  let offset = 0;
  const limit = 25;

  while (true) {
    try {
      const params = new URLSearchParams({ limit, offset });
      const data = await fetchJSON(`${OPSGENIE_API_URL}/v1/services?${params}`, {
        headers: {
          'Authorization': `GenieKey ${OPSGENIE_API_TOKEN}`,
          'Accept': 'application/json',
        },
      });

      const fetchedServices = data.data;
      if (fetchedServices.length === 0) {
        console.log('No more Opsgenie services found.');
        break;
      }

      console.log(`Fetched ${fetchedServices.length} Opsgenie services from offset ${offset}.`);
      services.push(...fetchedServices);
      offset += limit;
    } catch (error) {
      console.error('Error fetching Opsgenie services:', error.message);
      break;
    }
  }

  opsgenieServicesCache = services;
  console.log(`Cached ${opsgenieServicesCache.length} Opsgenie services.`);
}

async function fetchAndCacheRootlyServices() {
  console.log('Fetching Rootly services...');
  const services = [];
  let page = 1;
  const pageSize = 100;

  while (true) {
    try {
      const params = new URLSearchParams({ 'page[number]': page, 'page[size]': pageSize });
      const data = await fetchJSON(`${ROOTLY_API_URL}/services?${params}`, {
        headers: {
          'Authorization': `Bearer ${ROOTLY_API_TOKEN}`,
        },
      });

      const fetchedServices = data.data;
      if (fetchedServices.length === 0) {
        console.log('No more services found.');
        break;
      }

      console.log(`Fetched ${fetchedServices.length} services from page ${page}.`);
      services.push(...fetchedServices);
      page += 1;
    } catch (error) {
      console.error('Error fetching Rootly services:', error.message);
      break;
    }
  }

  rootlyServicesCache = services;
  return services;
}

async function fetchDatadogMonitors() {
  console.log('Fetching Datadog monitors...');
  const monitors = [];
  let page = 0;
  const pageSize = 100;

  while (true) {
    try {
      const params = new URLSearchParams({ page, page_size: pageSize });
      const data = await fetchJSON(`${DATADOG_API_URL}/monitor?${params}`, {
        headers: {
          'DD-API-KEY': DATADOG_API_KEY,
          'DD-APPLICATION-KEY': DATADOG_APP_KEY,
        },
      });

      if (data.length === 0) {
        console.log('No more monitors found.');
        break;
      }

      console.log(`Fetched ${data.length} monitors from page ${page}.`);
      monitors.push(...data);
      page += 1;
    } catch (error) {
      console.error('Error fetching Datadog monitors:', error.message);
      break;
    }
  }

  return monitors;
}

function normalizedServiceName(serviceName) {
  return serviceName.replace(/[^\w_-]+/g, "_").toLowerCase().replace(/^[_-]/, "");
}

function getOpsgenieServiceId(serviceName) {
  console.log(`Looking up Opsgenie service ID for service name: ${serviceName}`);
  const service = opsgenieServicesCache.find(s => normalizedServiceName(s.name) === normalizedServiceName(serviceName));
  const serviceId = service ? service.id : null;
  if (serviceId) {
    console.log(`Found Opsgenie service ID: ${serviceId}`);
  } else {
    console.log(`Opsgenie service ID not found for service name: ${serviceName}`);
  }
  return serviceId;
}

function fetchRootlyServiceId(opsgenieId) {
  console.log(`Looking up Rootly service ID for Opsgenie ID: ${opsgenieId}`);
  const service = rootlyServicesCache.find(s => s.attributes.opsgenie_id === opsgenieId);
  const serviceId = service ? service.id : null;
  if (serviceId) {
    console.log(`Found Rootly service ID: ${serviceId}`);
  } else {
    console.log(`Rootly service ID not found for Opsgenie ID: ${opsgenieId}`);
  }
  return serviceId;
}

async function createDatadogWebhook(monitor, serviceName, serviceId) {
  try {
    if (DRY_RUN) {
      console.log(`Dry run - skipping creation of Datadog webhook for service: ${serviceName} with ID: ${serviceId}`);
    } else {
      console.log(`Creating Datadog webhook for service: ${serviceName} with ID: ${serviceId}`);
      await fetchJSON(`${DATADOG_API_URL}/integration/webhooks/configuration/webhooks`, {
        method: 'POST',
        headers: {
          'DD-API-KEY': DATADOG_API_KEY,
          'DD-APPLICATION-KEY': DATADOG_APP_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: `rootly-${normalizedServiceName(serviceName)}`,
          url: 'https://webhooks.rootly.com/webhooks/incoming/datadog_webhooks',
          payload: JSON.stringify({
            "id": "$ID",
            "body": "$EVENT_MSG",
            "last_updated": "$LAST_UPDATED",
            "event_type": "$EVENT_TYPE",
            "title": "$EVENT_TITLE",
            "alert_id": "$ALERT_ID",
            "alert_metric": "$ALERT_METRIC",
            "alert_priority": "$ALERT_PRIORITY",
            "alert_query": "$ALERT_QUERY",
            "alert_scope": "$ALERT_SCOPE",
            "alert_status": "$ALERT_STATUS",
            "alert_title": "$ALERT_TITLE",
            "alert_transition": "$ALERT_TRANSITION",
            "alert_type": "$ALERT_TYPE",
            "alert_cycle_key": "$ALERT_CYCLE_KEY",
            "date": "$DATE",
            "org": { "id": "$ORG_ID", "name": "$ORG_NAME" },
            "rootly": {
              "notification_target": {
                "type": "Service",
                "id": serviceId,
              },
            },
          }),
          custom_headers: JSON.stringify({ secret: ROOTLY_ALERT_SOURCE_SECRET }),
        }),
      });
      console.log(`Datadog webhook created for service: ${serviceName}`);
    }
  } catch (error) {
    const errorMsg = error.data?.errors?.[0];
    if (errorMsg === "Webhook already exists") {
      console.log(`Webhook already exists: @webhook-rootly-${normalizedServiceName(serviceName)}`);
    } else {
      results.push({ monitor: monitor, new: `@webhook-rootly-${normalizedServiceName(serviceName)}`, error: errorMsg || error.message });
      console.error('Error creating Datadog webhook:', error.message);
    }
  }
}

async function updateDatadogMonitor(monitorId, patches) {
  try {
    const ddHeaders = {
      'DD-API-KEY': DATADOG_API_KEY,
      'DD-APPLICATION-KEY': DATADOG_APP_KEY,
      'Content-Type': 'application/json',
    };

    const monitor = await fetchJSON(`${DATADOG_API_URL}/monitor/${monitorId}`, {
      headers: ddHeaders,
    });

    if (monitor) {
      const oldMessage = monitor.message;

      patches.forEach(([oldNotification, newNotification]) => {
        monitor.message = monitor.message.replace(oldNotification, `${oldNotification} ${newNotification}`);
      });

      results.push({ monitor: monitor, oldMessage: oldMessage, newMessage: monitor.message });

      if (DRY_RUN) {
        console.log(`Dry run enabled, skipping update of Datadog monitor ID: ${monitorId}`);
      } else {
        console.log(`Updating Datadog monitor ID: ${monitorId}`);

        if (monitor.type === 'synthetics alert' && monitor.options.synthetics_check_id) {
          await fetchJSON(`${DATADOG_API_URL}/synthetics/tests/${monitor.options.synthetics_check_id}`, {
            method: 'PATCH',
            headers: ddHeaders,
            body: JSON.stringify({ data: [{ path: "/message", op: "replace", value: monitor.message }] }),
          });
        } else {
          await fetchJSON(`${DATADOG_API_URL}/monitor/${monitorId}`, {
            method: 'PUT',
            headers: ddHeaders,
            body: JSON.stringify(monitor),
          });
        }
        console.log(`Updated monitor ID: ${monitorId}: ${patches}`);
      }
    } else {
      console.log(`Monitor ID: ${monitorId} not found.`);
    }
  } catch (error) {
    const errorMsg = error.data?.errors?.[0];
    results.push({ monitor: { id: monitorId }, error: errorMsg || error.message });
    console.error('Error updating Datadog monitor:', error.message);
  }
}

async function processMonitor(monitor) {
  try {
    if (monitor.message.match(/@webhook-rootly-[^\s]+/)) {
      console.log(`Skipping monitor ID: ${monitor.id} as it already contains @webhook-rootly.`);
      results.push({ monitor: monitor, old: null, new: null, error: `Skipping monitor ID: ${monitor.id} as it already contains @webhook-rootly.` });
      return;
    }

    const notifications = monitor.message.match(/@opsgenie-([^\s]+)/g);
    if (notifications) {
      console.log(`Processing monitor ID: ${monitor.id} with ${notifications.length} Opsgenie notifications.`);

      const patches = (await Promise.all(notifications.map(async function(notification) {
        const serviceName = notification.split('@opsgenie-')[1];
        const opsgenieId = getOpsgenieServiceId(serviceName);

        if (opsgenieId) {
          const rootlyId = fetchRootlyServiceId(opsgenieId);
          if (rootlyId) {
            await createDatadogWebhook(monitor, serviceName, rootlyId);
            const newNotification = `@webhook-rootly-${normalizedServiceName(serviceName)}`;
            results.push({ monitor: monitor, old: notification, new: newNotification, error: null });
            return [notification, newNotification];
          } else {
            results.push({ monitor: monitor, old: notification, error: `Rootly ID not found for Opsgenie ID: ${opsgenieId}` });
            console.error(`Rootly ID not found for Opsgenie ID: ${opsgenieId}`);
          }
        } else {
          results.push({ monitor: monitor, old: notification, error: `Opsgenie ID not found for service name: ${serviceName}` });
          console.error(`Opsgenie ID not found for service name: ${serviceName}`);
        }
      }))).filter(Boolean);

      if (patches.length) {
        await updateDatadogMonitor(monitor.id, patches);
      }
    } else {
      results.push({ monitor: monitor, old: null, new: null, error: `No Opsgenie notifications found in monitor ID: ${monitor.id}` });
      console.log(`No Opsgenie notifications found in monitor ID: ${monitor.id}`);
    }
  } catch (error) {
    console.error(`Error processing monitor ID: ${monitor.id}`, error.message);
  }
}

function resultsCSV(data) {
  const rows = data || results;
  const headers = ['Monitor', 'Monitor Name', 'Notification', 'Notification to append', 'Monitor message', 'New monitor message', 'Error'];
  const csv = [headers];

  rows.forEach((result) => {
    csv.push([
      result.monitor?.id?.toString() || "",
      result.monitor?.name || "",
      result.old || "",
      result.new || "",
      result.oldMessage || "",
      result.newMessage || "",
      result.error || "",
    ]);
  });

  return csv.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');
}

module.exports = { normalizedServiceName, resultsCSV };
