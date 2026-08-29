# xaligo — Diagram Creation Guide

> Bundled offline reference for the `xaligo` VS Code extension. See
> [README.md](README.md) for how to point an AI assistant at this file.
> DSL specification: [xal-spec.md](xal-spec.md).

Standard workflow for creating SVG and PPTX diagrams with the `.xal` DSL. The
command-line examples below assume the `xaligo` CLI is on your
`PATH` (it ships as `node_modules/@xaligo/xaligo/bin/xaligo.cjs`). Inside this
VS Code extension, use the export commands (**xaligo: Export as SVG/PPTX**) for
the currently open `.xal` file. Run the command-line examples in your own shell
when you need lower-level CLI operations.

---

## Step 1 — Find Service IDs

`service-index.csv` maps service IDs to service names. It ships with the
xaligo core package at `etc/resources/aws/service-index.csv` (or, once
installed, `node_modules/@xaligo/xaligo/etc/resources/aws/service-index.csv`).
Use `grep` to search for the services you need.

```bash
# Format: id,service
grep -i "ec2"          node_modules/@xaligo/xaligo/etc/resources/aws/service-index.csv
grep -i "rds\|aurora"  node_modules/@xaligo/xaligo/etc/resources/aws/service-index.csv
grep -i "cloudfront"   node_modules/@xaligo/xaligo/etc/resources/aws/service-index.csv
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

- Column 1 (`id`) as a number → icon is fetched from the bundled service
  catalog.
- Lines starting with `#` are treated as comments and ignored.
- `Abbreviation`, when set, is used as the **icon label inside the diagram**
  and in the standalone legend icon below the frame. When empty, a built-in
  abbreviation table is used as fallback.
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

> **Note:** rendering with `--services` warns when an `<item id="N">` in the .xal
> is not listed in services.csv, or when a services.csv entry has no corresponding
> `<item>` in the diagram. Keep both files in sync to suppress these warnings.

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
<xaligo version="1">
  <frames>
    <frame id="overview" width="1440" height="900" class="pa-4">
      <aws-cloud id="aws-cloud" title="AWS Cloud">

    <!-- ✅ Global: outside <region> — not bound to any specific region -->
    <generic-group id="global-services" title="Global Services">
      <item id="1179" />  <!-- Route 53 -->
      <item id="216"  />  <!-- IAM -->
    </generic-group>

    <region id="region-apne1" title="ap-northeast-1" row="8">

      <!-- ✅ Regional: inside <region>, outside <vpc> — no VPC required -->
      <generic-group id="managed-serverless" title="Managed &amp; Serverless">
        <item id="13"   />  <!-- Lambda -->
        <item id="1020" />  <!-- S3 -->
      </generic-group>

      <vpc id="vpc-main" title="VPC (10.0.0.0/16)" row="6">

        <!-- ✅ VPC-edge: inside <vpc>, outside <availability-zone> -->
        <generic-group id="vpc-edge" title="VPC Edge">
          <item id="1581" />  <!-- Internet Gateway -->
          <item id="1182" />  <!-- ELB -->
        </generic-group>

        <row gap="8" row="5">
          <col span="6">
            <availability-zone id="az-apne1a" title="AZ: ap-northeast-1a">
              <!-- ✅ AZ-specific: public-subnet for NAT Gateway -->
              <public-subnet id="public-subnet-a" title="Public Subnet">
                <item id="1582" />  <!-- NAT Gateway -->
              </public-subnet>
              <!-- ✅ AZ-specific: compute instances in private subnet -->
              <private-subnet id="app-tier-a" title="Application Tier" row="3">
                <item id="27"  />   <!-- EC2 -->
                <item id="547" />   <!-- ECS -->
              </private-subnet>
            </availability-zone>
          </col>
          <col span="6">
            <availability-zone id="az-apne1b" title="AZ: ap-northeast-1b">
              <!-- ✅ AZ-specific: DB instances in private subnet -->
              <private-subnet id="data-tier-b" title="Data Tier">
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
  </frames>
</xaligo>
```

This repository's own `examples/sample.xal` and `examples/services.csv` are a
larger worked example of this same pattern.

---

## Step 4 — Render the file

```bash
xaligo render sample.xal \
  --format svg \
  -o output/sample.svg \
  --services services.csv
```

`--services` is strongly recommended for this workflow. The CSV provides
icon label overrides and service metadata. In this extension, use
**xaligo: Export as SVG** or **xaligo: Export as PPTX** instead — both discover
the nearest `services.csv`/`<name>.services.csv` automatically.

> **Note:** Create the output directory if it does not already exist.
> ```bash
> mkdir -p output
> ```

---

## Command Reference

| Command | Description |
|---|---|
| `grep -i "<name>" .../etc/resources/aws/service-index.csv` | Search for a service ID |
| `xaligo icon search <query>` | Search the local namespaced SVG icon registry |
| `xaligo render <xal> --format svg -o <out.svg> --services <csv>` | Convert .xal → SVG with a service legend |
| `xaligo render <xal> --format pptx -o <out.pptx> --services <csv> --paper A3 --orientation landscape` | Convert .xal → PPTX with the native Rust exporter |
| `xaligo rag index` / `xaligo rag search <query>` | Build or query the local Markdown/semantic knowledge index |

## PPTX Notes

- PPTX export is statically linked into the native xaligo binary; there is no
  separate WASM runtime resource.
- PPTX export adds separate legend slide(s) after the diagram slide.
- Legend pages use 4 columns and show icon, abbreviation, and official name.
- Use `--paper A3 --orientation landscape --paper-margin-top 0.75 --paper-margin-bottom 0.75`
  for a large AWS diagram.
- Connector routing uses the shared native scene and avoids icon/label
  obstacles.
- Group header tag labels are intentionally single-line in PPTX output; keep
  tag background width and label width in sync when adjusting tag text metrics.
- Keep a diagram's `.xal` and `services.csv` in sync so the legend includes
  every diagram service.

## Native V2

V2 uses the reject-safe `<scene version="2">` root introduced in xaligo 0.2.1.
V1 remains the frozen compatibility profile.

```xml
<scene version="2" width="320" height="180" layout="horizontal">
  <item id="client">Client</item>
  <item id="api" icon="builtin:service">API</item>
  <line source="client" target="api" routing="orthogonal"
        target-arrow="arrow" />
</scene>
```
