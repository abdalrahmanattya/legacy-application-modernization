# Wave 3 cost model

`tools/infrastructure/cost-inputs.example.json` is a versioned, adjustable
assumption set. Values are dated illustrative estimates, not a current AWS
price quote. The calculator intentionally separates ECS, Aurora, ALB, WAF /
CloudWatch / storage, NAT, and interface endpoint components. Run it with:

```bash
node scripts/infrastructure/cost-calculator.js tools/infrastructure/cost-inputs.example.json
```

The model compares nonprod idle, prod idle, prod load, and a NAT-based prod
scenario. The NAT-free design trades hourly NAT processing for interface
endpoints and gateway endpoints; actual prices, data transfer, Aurora storage,
requests, and CloudWatch ingestion must be refreshed from the AWS pricing
pages before a budget approval. Do not treat generated totals as billing
evidence. Budget notifications require explicit email inputs and approval.
