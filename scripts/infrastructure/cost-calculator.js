#!/usr/bin/env node
const fs = require("node:fs");

const file = process.argv[2] || "tools/infrastructure/cost-inputs.example.json";
const input = JSON.parse(fs.readFileSync(file, "utf8"));
const a = input.assumptions;
const monthly = (scenario) => {
  const hours = a.hours_per_month;
  const ecs = scenario.tasks * hours * a.ecs_task_hourly;
  const aurora = scenario.aurora_acu * hours * a.aurora_acu_hourly;
  const alb = hours * a.alb_hourly;
  const edge = a.waf_monthly + a.cloudwatch_monthly + a.s3_sqs_ecr_monthly;
  const nat =
    scenario.nat_gateways *
    (hours * a.nat_gateway_hourly + a.nat_processing_monthly);
  const endpoints =
    scenario.interface_endpoints * hours * a.endpoint_hourly_each;
  return {
    ecs,
    aurora,
    alb,
    edge,
    nat,
    endpoints,
    total: ecs + aurora + alb + edge + nat + endpoints,
  };
};
const result = {
  currency: input.currency,
  model_date: input.model_date,
  scenarios: {},
};
for (const [name, scenario] of Object.entries(input.scenarios))
  result.scenarios[name] = monthly(scenario);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
