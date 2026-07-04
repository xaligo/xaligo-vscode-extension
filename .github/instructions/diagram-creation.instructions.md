---
applyTo: "**"
---

# xaligo — Diagram Creation Guide

Standard workflow for creating Excalidraw and PPTX diagrams.

---

## Step 1 — Find Service IDs

`etc/resources/aws/service-index.csv` maps service IDs to service names.
Use `grep` to search for the services you need.

```bash
# Format: id,service
grep -i "ec2"          etc/resources/aws/service-index.csv
grep -i "rds\|aurora"  etc/resources/aws/service-index.csv
grep -i "cloudfront"   etc/resources/aws/service-index.csv
```

Example output:
```
27,Amazon EC2
117,Amazon RDS
1178,Amazon CloudFront
```

---

## Step 2 — Create services.csv

`services.csv` lists the services to include in the diagram.

**Format:** `id,OfficialName,Abbreviation,Summary,Usage,Notes`

- Column 1 (`id`) as a number → icon is fetched from service-catalog.csv.
- Lines starting with `#` are treated as comments and ignored.
- `Abbreviation`, when set, is used as the **icon label inside the diagram** and in the standalone legend icon below the frame.
  - Takes priority over the built-in abbreviation table in
    `internal/entity/service.go`.
  - When empty, the built-in table is used as fallback.
- `OfficialName` is displayed as the full-name text in legends.

```csv
# 3-tier Architecture service list — IDs must match <item> tags in the .xal file
# Format: id,OfficialName,Abbreviation,Summary,Usage,Notes
1179,Amazon Route 53,R53,DNS web service,Domain name resolution and health checks,
1581,Amazon VPC Internet Gateway,IGW,Internet connectivity,Inbound/outbound internet traffic,
1182,Elastic Load Balancing,ELB,Load balancing service,Distribute traffic across EC2 instances,
27,Amazon EC2,EC2,Virtual server,Application tier,
1582,Amazon VPC NAT Gateway,NATGW,NAT gateway,Outbound internet for private subnets,
110,Amazon Aurora,Aurora,Relational database,High-performance managed DB,
113,Amazon ElastiCache,EC,In-memory caching,Session and query cache,
```

> **Note:** `render --format excalidraw` warns to stderr when an `<item id="N">` in the .xal
> is not listed in services.csv, or when a services.csv entry has no corresponding
> `<item>` in the diagram.  Keep both files in sync to suppress these warnings.

Reference: [examples/services.csv](../../examples/services.csv)

---

## Step 3 — Create a .xal file

Use `<item id="N" />` to place service icons in the layout.
`N` is the service ID from the first column of service-index.csv.

### Choosing the right group tag

Use AWS-specific group tags only when the content matches the tag's meaning.
For logical groupings that do not correspond to a specific AWS construct, use `<generic-group>`.

| Tag | When to use |
|---|---|
| `<public-subnet>` | Items that belong to a public (internet-routable) subnet |
| `<private-subnet>` | Items that belong to a private subnet |
| `<security-group>` | Resources sharing an EC2 security group |
| `<auto-scaling-group>` | An EC2 Auto Scaling group |
| `<generic-group>` | Any logical grouping that does not fit the above (security services, storage tiers, CI/CD, etc.) |

> **Incorrect:** using `<public-subnet title="Security &amp; Identity">` for IAM / WAF — these are not subnet resources.
> **Correct:** use `<generic-group title="Security &amp; Identity">` instead.

### Service Scope Validation

Before finalizing the `.xal`, verify that each service is placed at the correct scope level.
Placing a global or regional service inside an `<availability-zone>` is misleading.

| Scope | Placement in .xal | Typical services |
|---|---|---|
| **Global** | Direct child of `<aws-cloud>`, inside `<generic-group>` | Route 53, CloudFront, IAM, WAF |
| **Regional** | Inside `<region>`, outside `<vpc>`, inside `<generic-group>` | Lambda, S3, CloudWatch, SQS, SNS, EventBridge, Step Functions, CodePipeline, Macie |
| **VPC-level** | Inside `<vpc>`, outside `<availability-zone>`, inside `<generic-group>` | Internet Gateway, ELB/ALB, Secrets Manager |
| **AZ-specific** | Inside `<availability-zone>`, in `<public-subnet>` / `<private-subnet>` | EC2, NAT Gateway, RDS instance, Aurora replica, ElastiCache node, ECS task, EKS node |

> **Incorrect:** placing Route 53 or IAM inside `<availability-zone>` — these services are not AZ-bound.
> **Correct:** group them under `<generic-group title="Global Services">` as a direct child of `<aws-cloud>`.

Quick checklist:
- [ ] Global services (Route 53, CloudFront, IAM, WAF) → outside `<region>`
- [ ] Regional managed services (Lambda, S3, SQS, etc.) → inside `<region>`, outside `<vpc>`
- [ ] Network edge (IGW, ELB) → inside `<vpc>`, outside `<availability-zone>`
- [ ] Compute/DB instances → inside `<availability-zone>`
- [ ] Services not tied to a VPC → never inside `<vpc>` or `<availability-zone>`

```xml
<frame width="1440" height="900" class="pa-4">
  <aws-cloud title="AWS Cloud">

    <!-- ✅ Global: outside <region> — not bound to any specific region -->
    <generic-group title="Global Services">
      <item id="1179" />  <!-- Route 53 -->
      <item id="216"  />  <!-- IAM -->
    </generic-group>

    <region title="ap-northeast-1" row="8">

      <!-- ✅ Regional: inside <region>, outside <vpc> — no VPC required -->
      <generic-group title="Managed &amp; Serverless">
        <item id="13"   />  <!-- Lambda -->
        <item id="1020" />  <!-- S3 -->
      </generic-group>

      <vpc title="VPC (10.0.0.0/16)" row="6">

        <!-- ✅ VPC-edge: inside <vpc>, outside <availability-zone> -->
        <generic-group title="VPC Edge">
          <item id="1581" />  <!-- Internet Gateway -->
          <item id="1182" />  <!-- ELB -->
        </generic-group>

        <row gap="8" row="5">
          <col span="6">
            <availability-zone title="AZ: ap-northeast-1a">
              <!-- ✅ AZ-specific: public-subnet for NAT Gateway -->
              <public-subnet title="Public Subnet">
                <item id="1582" />  <!-- NAT Gateway -->
              </public-subnet>
              <!-- ✅ AZ-specific: compute instances in private subnet -->
              <private-subnet title="Application Tier" row="3">
                <item id="27"  />   <!-- EC2 -->
                <item id="547" />   <!-- ECS -->
              </private-subnet>
            </availability-zone>
          </col>
          <col span="6">
            <availability-zone title="AZ: ap-northeast-1b">
              <!-- ✅ AZ-specific: DB instances in private subnet -->
              <private-subnet title="Data Tier">
                <item id="117" />   <!-- RDS -->
                <item id="110" />   <!-- Aurora -->
              </private-subnet>
            </availability-zone>
          </col>
        </row>

      </vpc>
    </region>
  </aws-cloud>

  <connection src="1182" dst="27" />
  <connection src="27"   dst="117" />
</frame>
```

Reference: [examples/sample.xal](../../examples/sample.xal)
DSL specification: [xal-spec.instructions.md](xal-spec.instructions.md)

---

## Step 4 — Render the Excalidraw file

```bash
xaligo render examples/sample.xal \
  --format excalidraw \
  -o output/sample.excalidraw \
  --services examples/services.csv
```

`--services` is strongly recommended for this workflow. The CSV provides
icon label overrides and service metadata.

> **Note:** Create the output directory if it does not already exist.
> ```bash
> mkdir -p output
> ```

---

## Command Reference

| Command | Description |
|---|---|
| `grep -i "<name>" etc/resources/aws/service-index.csv` | Search for a service ID |
| `xaligo render <xal> --format excalidraw -o <out> --services <csv>` | Convert .xal → .excalidraw with legend |
| `xaligo render <xal> --format pptx -o <out.pptx> --services <csv> --paper A3 --orientation landscape` | Convert .xal → PPTX when the WASI exporter is configured |
| `xaligo add service --list <csv> --file <excalidraw>` | Add service icons to an existing file |
| `xaligo render <xal> -o <excalidraw>` | Convert .xal → .excalidraw without legend |

## PPTX Notes

- Native CLI export requires `xaligo.wasm`; the npm/WASM API currently
  exports through PptxGenJS.
- PPTX export adds separate legend slide(s) after the diagram slide.
- Legend pages use 4 columns and show icon, abbreviation, and official name.
- Use `--paper A3 --orientation landscape --paper-margin-top 0.75 --paper-margin-bottom 0.75`
  for the current large AWS sample.
- Connector routing is resolved in Go/WASM and avoids icon/label obstacles.
- Group header tag labels are intentionally single-line in PPTX output; keep
  tag background width and label width in sync when adjusting tag text metrics.
- Keep `examples/sample.xal` and `examples/services.csv` in sync so the legend
  includes every diagram service.
