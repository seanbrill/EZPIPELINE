/**
 * AWS: what a deploy makes (ECS Fargate, EFS, a network load balancer), as the
 * Terraform that makes it, the permissions it needs, and the two pipelines that
 * run it: "Deploy to AWS" and "Remove from AWS".
 *
 * One container and one volume. Pipeline steps run inside the container, so it never
 * scales out: two copies on one SQLite database would corrupt it. The service is set
 * so a new task only starts once the old one has stopped.
 *
 * Everything goes in the region's default VPC, in two of its default subnets (one
 * per zone). The task has a public address so it can pull its image without a NAT
 * gateway; only the load balancer may reach it.
 */
import type { Draft } from "./store.js";
import { SIZES } from "./prices.js";

/**
 * Where the release pipeline publishes the image: FileFreak's container registry, which
 * answers at the API's host until cr.filefreak.io is set up. Public, so any instance pulls
 * it with no key. EZP_SELFHOST_IMAGE (a repository, no tag) points a deploy elsewhere.
 */
export const IMAGE_REPOSITORY = () => process.env.EZP_SELFHOST_IMAGE || "api.filefreak.io/ezpipeline/ezpipeline";
export const IMAGE_SOURCE = (version: string) => `${IMAGE_REPOSITORY()}:${version}`;
export const CONTAINER_PORT = 5000;

const hcl = (s: string) => JSON.stringify(s).replace(/\$\{/g, () => "$${").replace(/%\{/g, () => "%%{");

// ── Permissions ───────────────────────────────────────────────────────────

/**
 * What the deploy calls, grouped the way the Connect step shows it. A group is
 * allowed only when every action in it is: the Terraform needs them all.
 */
export function permissionGroups(d: Pick<Draft, "config">) {
  return [
    { id: "ecr", label: "Can create container registries", needed: true, actions: [
      "ecr:CreateRepository", "ecr:DescribeRepositories", "ecr:DeleteRepository", "ecr:ListTagsForResource", "ecr:TagResource",
      "ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage",
    ] },
    { id: "ecs", label: "Can create ECS services", needed: true, actions: [
      "ecs:CreateCluster", "ecs:DescribeClusters", "ecs:DeleteCluster", "ecs:RegisterTaskDefinition", "ecs:DeregisterTaskDefinition", "ecs:DescribeTaskDefinition",
      "ecs:CreateService", "ecs:UpdateService", "ecs:DescribeServices", "ecs:DeleteService", "ecs:TagResource",
    ] },
    { id: "iam", label: "Can make and pass the task role", needed: true, actions: [
      "iam:CreateRole", "iam:GetRole", "iam:DeleteRole", "iam:TagRole", "iam:AttachRolePolicy", "iam:DetachRolePolicy",
      "iam:ListAttachedRolePolicies", "iam:ListRolePolicies", "iam:ListInstanceProfilesForRole", "iam:PassRole",
    ] },
    { id: "efs", label: "Can create EFS", needed: true, actions: [
      "elasticfilesystem:CreateFileSystem", "elasticfilesystem:DescribeFileSystems", "elasticfilesystem:DeleteFileSystem", "elasticfilesystem:TagResource",
      "elasticfilesystem:DescribeLifecycleConfiguration", "elasticfilesystem:CreateMountTarget", "elasticfilesystem:DescribeMountTargets",
      "elasticfilesystem:DescribeMountTargetSecurityGroups", "elasticfilesystem:DeleteMountTarget",
    ] },
    { id: "elb", label: "Can create load balancers and security groups", needed: true, actions: [
      "elasticloadbalancing:CreateLoadBalancer", "elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DeleteLoadBalancer",
      "elasticloadbalancing:ModifyLoadBalancerAttributes", "elasticloadbalancing:DescribeLoadBalancerAttributes",
      "elasticloadbalancing:CreateTargetGroup", "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DeleteTargetGroup",
      "elasticloadbalancing:ModifyTargetGroupAttributes", "elasticloadbalancing:DescribeTargetGroupAttributes",
      "elasticloadbalancing:CreateListener", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DeleteListener",
      "elasticloadbalancing:AddTags", "elasticloadbalancing:DescribeTags",
      "ec2:DescribeVpcs", "ec2:DescribeSubnets", "ec2:DescribeNetworkInterfaces", "ec2:CreateSecurityGroup", "ec2:DescribeSecurityGroups",
      "ec2:DeleteSecurityGroup", "ec2:AuthorizeSecurityGroupIngress", "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupIngress",
      "ec2:RevokeSecurityGroupEgress", "ec2:CreateTags",
    ] },
    { id: "eip", label: "Can allocate Elastic IPs", needed: d.config.staticIp, actions: [
      "ec2:AllocateAddress", "ec2:ReleaseAddress", "ec2:DescribeAddresses", "ec2:DescribeAddressesAttribute",
    ] },
    { id: "acm", label: "Can request certificates", needed: d.config.address === "domain", actions: [
      "acm:RequestCertificate", "acm:DescribeCertificate", "acm:DeleteCertificate", "acm:ListTagsForCertificate", "acm:AddTagsToCertificate",
    ] },
    { id: "logs", label: "Can write logs", needed: true, actions: [
      "logs:CreateLogGroup", "logs:DescribeLogGroups", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:ListTagsForResource", "logs:TagResource",
    ] },
  ];
}

/** The IAM policy statement that grants what is missing, to paste on the user or role. */
export function policyStatement(denied: string[]) {
  return JSON.stringify({ Effect: "Allow", Action: [...new Set(denied)].sort(), Resource: "*" }, null, 2);
}

// ── What gets made ────────────────────────────────────────────────────────

export function resourceList(d: Draft) {
  const s = SIZES.find((x) => x.id === d.config.size) ?? SIZES[1];
  const n = d.config.name;
  const https = d.config.address === "domain";
  return [
    { label: "ECR repository", value: n },
    { label: "EFS file system", value: `${d.config.storageGb} GB estimate · encrypted` },
    { label: "ECS cluster", value: n },
    { label: "EFS mount targets", value: "2 zones" },
    { label: "Task definition", value: `${s.vcpu} vCPU · ${s.gb} GB` },
    { label: "Network load balancer", value: https ? "TLS on 443" : "TCP on 80" },
    { label: "ECS service", value: "1 task, never 2" },
    ...(d.config.staticIp ? [{ label: "Elastic IPs", value: "2" }] : []),
    { label: "IAM task role", value: `${n}-task` },
    ...(https ? [{ label: "ACM certificate", value: d.config.domain }] : []),
    { label: "Log group", value: "kept 30 days" },
    { label: "Security groups", value: https ? "443 in only" : "80 in only" },
  ];
}

// ── Terraform ─────────────────────────────────────────────────────────────

export interface TfInput { draft: Draft; account: string; version: string; statePath: string }

export function imageUri(d: Draft, account: string, version: string) {
  return `${account}.dkr.ecr.${d.config.region}.amazonaws.com/${d.config.name}:${version}`;
}

export function terraform({ draft: d, account, version, statePath }: TfInput): string {
  const s = SIZES.find((x) => x.id === d.config.size) ?? SIZES[1];
  const c = d.config;
  const domain = c.address === "domain" ? c.domain : "";
  return `# Made by EZPipeline's self-host wizard for "${c.name}" in ${c.region}.
# Change it in Settings > Self-hosting: this file is written again on every deploy.

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.60" }
  }
  # The state lives in this instance's data directory, next to this file.
  backend "local" {
    path = ${hcl(statePath)}
  }
}

provider "aws" {
  region = ${hcl(c.region)}
  default_tags {
    tags = { "ezpipeline:instance" = ${hcl(c.name)}, "managed-by" = "ezpipeline-selfhost" }
  }
}

# Set in secrets.auto.tfvars, which only this folder holds (mode 600).
variable "jwt_secret" {
  type      = string
  sensitive = true
}
variable "setup_token" {
  type      = string
  sensitive = true
}
# Turned on by the Point DNS step once the certificate is issued (https.auto.tfvars).
variable "https" {
  type    = bool
  default = false
}
variable "image" {
  type    = string
  default = ${hcl(imageUri(d, account, version))}
}

locals {
  name    = ${hcl(c.name)}
  port    = ${CONTAINER_PORT}
  domain  = ${hcl(domain)}
  static  = ${c.staticIp}
  subnets = slice(sort(data.aws_subnets.default.ids), 0, 2)
  listen  = var.https ? 443 : 80
}

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  filter {
    name   = "default-for-az"
    values = ["true"]
  }
}

resource "aws_ecr_repository" "ezpipeline" {
  name                 = local.name
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_cloudwatch_log_group" "ezpipeline" {
  name              = "/ezpipeline/\${local.name}"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "ezpipeline" {
  name = local.name
}

resource "aws_iam_role" "task" {
  name = "\${local.name}-task"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "task" {
  role       = aws_iam_role.task.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_security_group" "lb" {
  name        = "\${local.name}-lb"
  description = "EZPipeline load balancer: the one port in from anywhere"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port        = local.listen
    to_port          = local.listen
    protocol         = "tcp"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "task" {
  name        = "\${local.name}-task"
  description = "EZPipeline container: only the load balancer may reach it"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port       = local.port
    to_port         = local.port
    protocol        = "tcp"
    security_groups = [aws_security_group.lb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "efs" {
  name        = "\${local.name}-efs"
  description = "EZPipeline data volume: only the container may mount it"
  vpc_id      = data.aws_vpc.default.id
  ingress {
    from_port       = 2049
    to_port         = 2049
    protocol        = "tcp"
    security_groups = [aws_security_group.task.id]
  }
}

resource "aws_efs_file_system" "data" {
  creation_token = "\${local.name}-data"
  encrypted      = true
  tags           = { Name = "\${local.name}-data" }
}

resource "aws_efs_mount_target" "data" {
  count           = 2
  file_system_id  = aws_efs_file_system.data.id
  subnet_id       = local.subnets[count.index]
  security_groups = [aws_security_group.efs.id]
}

resource "aws_eip" "lb" {
  count  = local.static ? 2 : 0
  domain = "vpc"
  tags   = { Name = "\${local.name}-\${count.index}" }
}

resource "aws_lb" "ezpipeline" {
  name               = local.name
  load_balancer_type = "network"
  security_groups    = [aws_security_group.lb.id]
  dynamic "subnet_mapping" {
    for_each = range(2)
    content {
      subnet_id     = local.subnets[subnet_mapping.value]
      allocation_id = local.static ? aws_eip.lb[subnet_mapping.value].id : null
    }
  }
}

resource "aws_lb_target_group" "ezpipeline" {
  name                 = "\${local.name}-tg"
  port                 = local.port
  protocol             = "TCP"
  target_type          = "ip"
  vpc_id               = data.aws_vpc.default.id
  deregistration_delay = 30
  health_check {
    protocol            = "HTTP"
    path                = "/api/instance"
    matcher             = "200"
    healthy_threshold   = 3
    unhealthy_threshold = 3
    interval            = 30
  }
}

resource "aws_acm_certificate" "ezpipeline" {
  count             = local.domain == "" ? 0 : 1
  domain_name       = local.domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

# Plain TCP on 80 until the certificate is issued; then TLS on 443 only.
resource "aws_lb_listener" "http" {
  count             = var.https ? 0 : 1
  load_balancer_arn = aws_lb.ezpipeline.arn
  port              = 80
  protocol          = "TCP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ezpipeline.arn
  }
}

resource "aws_lb_listener" "https" {
  count             = var.https ? 1 : 0
  load_balancer_arn = aws_lb.ezpipeline.arn
  port              = 443
  protocol          = "TLS"
  certificate_arn   = aws_acm_certificate.ezpipeline[0].arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ezpipeline.arn
  }
}

resource "aws_ecs_task_definition" "ezpipeline" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = ${s.cpu}
  memory                   = ${s.memory}
  execution_role_arn       = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  volume {
    name = "data"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.data.id
      transit_encryption = "ENABLED"
    }
  }
  container_definitions = jsonencode([{
    name         = "ezpipeline"
    image        = var.image
    essential    = true
    portMappings = [{ containerPort = local.port, protocol = "tcp" }]
    mountPoints  = [{ sourceVolume = "data", containerPath = "/data" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = tostring(local.port) },
      { name = "EZP_DATA_DIR", value = "/data" },
      { name = "JWT_SECRET", value = var.jwt_secret },
      { name = "EZP_SETUP_TOKEN", value = var.setup_token },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ezpipeline.name
        "awslogs-region"        = ${hcl(c.region)}
        "awslogs-stream-prefix" = "ezpipeline"
      }
    }
  }])
}

resource "aws_ecs_service" "ezpipeline" {
  name            = "\${local.name}-svc"
  cluster         = aws_ecs_cluster.ezpipeline.id
  task_definition = aws_ecs_task_definition.ezpipeline.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  # single node: stop the old task before a new one starts
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  health_check_grace_period_seconds  = 180
  network_configuration {
    subnets          = local.subnets
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.ezpipeline.arn
    container_name   = "ezpipeline"
    container_port   = local.port
  }
  depends_on = [aws_lb_listener.http, aws_lb_listener.https, aws_efs_mount_target.data]
}

output "lb_dns" {
  value = aws_lb.ezpipeline.dns_name
}
output "static_ips" {
  value = aws_eip.lb[*].public_ip
}
output "certificate_arn" {
  value = local.domain == "" ? "" : aws_acm_certificate.ezpipeline[0].arn
}
output "certificate_records" {
  value = local.domain == "" ? [] : [for o in aws_acm_certificate.ezpipeline[0].domain_validation_options : "\${o.resource_record_name} CNAME \${o.resource_record_value}"]
}
`;
}

// ── The pipelines ─────────────────────────────────────────────────────────

/** Everything the steps read, set as the deploy pipeline's variables. Bare $NAME in the scripts, never braces. */
export function pipelineVars(d: Draft, o: { dir: string; local: string; version: string; account: string }) {
  return {
    EZP_SH_ID: d.id,
    EZP_SH_DIR: o.dir,
    EZP_SH_LOCAL: o.local,
    EZP_SH_NAME: d.config.name,
    EZP_SH_DOMAIN: d.config.address === "domain" ? d.config.domain : "",
    EZP_SH_VERSION: o.version,
    EZP_SH_IMAGE_SOURCE: IMAGE_SOURCE(o.version),
    EZP_SH_IMAGE: imageUri(d, o.account, o.version),
    EZP_SH_MOVE: d.data.mode,
    AWS_REGION: d.config.region,
    AWS_DEFAULT_REGION: d.config.region,
    AWS_PAGER: "",
    TF_IN_AUTOMATION: "1",
    TF_INPUT: "0",
    ...(d.connect.mode === "profile" ? { AWS_PROFILE: d.connect.profile } : {}),
  };
}

export const DEPLOY_STEPS = ["Check the tools", "Create container registry", "Push image", "Create volume", "Create service", "Wait for health check", "Move data", "Point DNS"] as const;

const step = (name: string, description: string, run: string) =>
  `  - name: ${name}\n    description: ${JSON.stringify(description)}\n    shell: /bin/bash\n    run: |\n${run.trim().split("\n").map((l) => "      " + l).join("\n")}\n`;

const TF = `cd "$EZP_SH_DIR/tf"
tf() { terraform "$@" -no-color; }`;

export function deployYaml(d: Draft, pipelineId: string): string {
  return `# The self-host wizard writes this pipeline. Change the deploy in Settings > Self-hosting:
# it writes this file again, and a run from there starts at the step that needs it.
id: "${pipelineId}"
appName: ${JSON.stringify(`Deploy ${d.config.name} to AWS`)}
version: 1.0.0
description: >
  Runs the Terraform in this instance's data directory (selfhost/${d.id}/tf) to put
  EZPipeline on ECS Fargate in ${d.config.region}, then moves this instance's data across.

steps:
${step(DEPLOY_STEPS[0], "The AWS CLI, Terraform and Docker, the account, and terraform init.", `
set -euo pipefail
for tool in aws terraform docker curl; do
  command -v "$tool" >/dev/null || { echo "MISSING program: $tool. Install it from Settings, Plugins (AWS CLI, Terraform, Docker), then retry."; exit 1; }
done
aws --version
terraform version | head -1
docker version --format 'docker {{.Server.Version}}' || { echo "Docker is installed but its daemon is not running here. Start it, then retry."; exit 1; }
who=$(aws sts get-caller-identity --query Arn --output text) || { echo "AWS did not accept the sign-in. Connect again in Settings, Self-hosting."; exit 1; }
echo "Signed in to AWS as $who"
${TF}
tf init -input=false -upgrade
`)}
${step(DEPLOY_STEPS[1], `ECR · ${d.config.name}`, `
set -euo pipefail
${TF}
tf apply -auto-approve -input=false -target=aws_ecr_repository.ezpipeline
`)}
${step(DEPLOY_STEPS[2], "The published EZPipeline image, copied into the registry", `
set -euo pipefail
echo "Pulling $EZP_SH_IMAGE_SOURCE (linux/amd64)"
if ! docker pull --quiet --platform linux/amd64 "$EZP_SH_IMAGE_SOURCE"; then
  echo "Could not pull $EZP_SH_IMAGE_SOURCE. Its owner makes it public on FileFreak (Developers, Container images, Who can pull it),"
  echo "or this host signs in to FileFreak's registry once: filefreak docker setup. Then retry this step."
  exit 1
fi
registry=$(echo "$EZP_SH_IMAGE" | cut -d/ -f1)
aws ecr get-login-password | docker login --username AWS --password-stdin "$registry"
docker tag "$EZP_SH_IMAGE_SOURCE" "$EZP_SH_IMAGE"
docker push "$EZP_SH_IMAGE"
`)}
${step(DEPLOY_STEPS[3], "EFS · encrypted · 2 mount targets", `
set -euo pipefail
${TF}
tf apply -auto-approve -input=false -target=aws_efs_mount_target.data
`)}
${step(DEPLOY_STEPS[4], "The load balancer, the task and the service", `
set -euo pipefail
${TF}
tf apply -auto-approve -input=false
echo "Load balancer: $(tf output -raw lb_dns)"
`)}
${step(DEPLOY_STEPS[5], "The container must answer 3 times in a row", `
set -euo pipefail
${TF}
if [ -f https.auto.tfvars ]; then url="https://$EZP_SH_DOMAIN"; else url="http://$(tf output -raw lb_dns)"; fi
echo "Asking $url/api/instance every 10 seconds, for up to 15 minutes"
ok=0
for i in $(seq 1 90); do
  if body=$(curl -fsS --max-time 8 "$url/api/instance" 2>/dev/null) && echo "$body" | grep -q '"app":"ezpipeline"'; then
    ok=$((ok + 1)); echo "answered ($ok of 3): $body"
    [ "$ok" -ge 3 ] && exit 0
  else
    [ "$ok" -gt 0 ] && echo "stopped answering after $ok"
    ok=0
    [ $((i % 6)) -eq 0 ] && echo "still starting ($((i / 6)) min). The service's events: aws ecs describe-services --cluster $EZP_SH_NAME --services $EZP_SH_NAME-svc"
  fi
  sleep 10
done
echo "The container did not answer in 15 minutes. Its own log is in CloudWatch, group /ezpipeline/$EZP_SH_NAME:"
aws logs tail "/ezpipeline/$EZP_SH_NAME" --since 20m 2>&1 | tail -n 30 || true
exit 1
`)}
${step(DEPLOY_STEPS[6], "The users, and this instance's data or a bundle, sealed", `
set -euo pipefail
${TF}
if [ -f https.auto.tfvars ]; then url="https://$EZP_SH_DOMAIN"; else url="http://$(tf output -raw lb_dns)"; fi
# This instance builds the bundle and hands it over, encrypted with a key only the new
# instance has (its setup token), so it is safe over the load balancer's plain address.
curl -sS --fail-with-body --max-time 1800 -X POST \\
  -H "x-ezp-selfhost: $EZP_SH_MOVE_TOKEN" -H "content-type: application/json" \\
  -d "{\\"to\\":\\"$url\\"}" "$EZP_SH_LOCAL/api/selfhost/$EZP_SH_ID/move"
echo
`)}
${step(DEPLOY_STEPS[7], d.config.address === "domain" ? `${d.config.domain} → load balancer, then the certificate` : "No custom domain: the load balancer's own address", `
set -euo pipefail
${TF}
lb=$(tf output -raw lb_dns)
if [ -z "$EZP_SH_DOMAIN" ]; then
  echo "No custom domain. EZPipeline answers at http://$lb"
  echo "That address has no HTTPS: add a domain in Settings, Self-hosting to get a certificate."
  exit 0
fi
if [ -f https.auto.tfvars ]; then echo "HTTPS is already on for $EZP_SH_DOMAIN"; exit 0; fi
arn=$(tf output -raw certificate_arn)
echo "Add these DNS records where $EZP_SH_DOMAIN's zone is hosted:"
echo "  $EZP_SH_DOMAIN CNAME $lb"
tf output -json static_ips | tr -d '[]"' | tr ',' '\\n' | grep . | sed "s/^/  (or, for a zone apex) $EZP_SH_DOMAIN A /" || true
tf output -json certificate_records | tr -d '[]"' | tr ',' '\\n' | grep . | sed 's/^/  /'
echo "Waiting for AWS to issue the certificate, for up to 2 hours (it checks the second record)"
for i in $(seq 1 240); do
  st=$(aws acm describe-certificate --certificate-arn "$arn" --query Certificate.Status --output text)
  case "$st" in
    ISSUED) echo "Certificate issued"; break ;;
    PENDING_VALIDATION) [ $((i % 10)) -eq 0 ] && echo "still waiting for the DNS record ($((i / 2)) min)" ;;
    *) echo "The certificate is $st, so AWS will not issue it. Check the records above, then retry."; exit 1 ;;
  esac
  [ "$i" -eq 240 ] && { echo "No certificate after 2 hours. Check the records above, then retry this step."; exit 1; }
  sleep 30
done
echo 'https = true' > https.auto.tfvars
tf apply -auto-approve -input=false
echo "Waiting for https://$EZP_SH_DOMAIN to answer (DNS can take a few minutes)"
for i in $(seq 1 60); do
  curl -fsS --max-time 8 "https://$EZP_SH_DOMAIN/api/instance" >/dev/null 2>&1 && { echo "EZPipeline answers at https://$EZP_SH_DOMAIN"; exit 0; }
  sleep 10
done
echo "https://$EZP_SH_DOMAIN does not answer yet. Check the CNAME above, then retry this step."
exit 1
`)}`;
}

export function removeYaml(d: Draft, pipelineId: string): string {
  return `# Removes everything the self-host wizard made for "${d.config.name}" in ${d.config.region},
# including the EFS volume and the data on it. Run from Settings > Self-hosting.
id: "${pipelineId}"
appName: ${JSON.stringify(`Remove ${d.config.name} from AWS`)}
version: 1.0.0
description: >
  terraform destroy for selfhost/${d.id}/tf. The volume and the data on it are deleted.

steps:
${step("Remove from AWS", "terraform destroy", `
set -euo pipefail
${TF}
[ -f "$EZP_SH_DIR/tf/terraform.tfstate" ] || { echo "Nothing to remove: there is no state, so nothing was made."; exit 0; }
tf init -input=false
tf destroy -auto-approve -input=false
echo "Removed. Nothing this deploy made is left in $AWS_REGION."
`)}`;
}
