/**
 * The price table the self-host wizard's estimates come from.
 *
 * On-demand list prices, in US dollars, for us-east-1. They change a few times a
 * year: update the numbers here and every estimate follows. An estimate is only
 * ever shown as an estimate; the cloud's own bill is the real number.
 *
 * Sources: aws.amazon.com/fargate/pricing, /elasticloadbalancing/pricing,
 * /vpc/pricing (public IPv4), /efs/pricing, /cloudwatch/pricing, /ecr/pricing.
 */

export const PRICES_AS_OF = "2026-11";
export const HOURS_PER_MONTH = 730;

export const AWS = {
  region: "us-east-1",
  /** Fargate, Linux on x86, per vCPU-hour and per GB-hour. */
  fargateVcpuHour: 0.04048,
  fargateGbHour: 0.004445,
  /** A network load balancer, per hour, plus one load balancer capacity unit (NLCU) per hour. */
  nlbHour: 0.0225,
  nlcuHour: 0.006,
  /** Every public IPv4 address, attached or not, per hour. */
  ipv4Hour: 0.005,
  /** EFS standard storage, per GB-month. */
  efsGbMonth: 0.30,
  /** CloudWatch Logs: about 2 GB of a server's own output a month, at $0.50 a GB ingested. */
  logsMonth: 1.0,
  /** ECR storage, per GB-month, for one image of about 0.6 GB. */
  ecrGbMonth: 0.10,
  imageGb: 0.6,
};

/** The sizes offered: what a pipeline step can use, since steps run inside the container. */
export const SIZES = [
  { id: "0.5", vcpu: 0.5, gb: 1, cpu: 512, memory: 1024, fits: "A few small pipelines" },
  { id: "1", vcpu: 1, gb: 2, cpu: 1024, memory: 2048, fits: "Most teams" },
  { id: "2", vcpu: 2, gb: 4, cpu: 2048, memory: 4096, fits: "Big builds, parallel runs" },
  { id: "4", vcpu: 4, gb: 8, cpu: 4096, memory: 8192, fits: "Large monorepo builds" },
] as const;
export type SizeId = (typeof SIZES)[number]["id"];

const round = (n: number) => Math.round(n * 100) / 100;

export function fargateMonthly(size: SizeId): number {
  const s = SIZES.find((x) => x.id === size) ?? SIZES[1];
  return round((s.vcpu * AWS.fargateVcpuHour + s.gb * AWS.fargateGbHour) * HOURS_PER_MONTH);
}

export interface EstimateLine { label: string; monthly: number }
export interface Estimate { lines: EstimateLine[]; total: number; note: string }

/**
 * What an AWS deploy costs a month. Three public IPv4 addresses whatever the
 * choices: the load balancer has one in each of its two zones (an Elastic IP or one
 * AWS assigns, priced the same), and the task has one so it can pull its image
 * without a NAT gateway, which would cost more than all three.
 */
export function awsEstimate(o: { size: SizeId; storageGb: number; region: string }): Estimate {
  const s = SIZES.find((x) => x.id === o.size) ?? SIZES[1];
  const lines: EstimateLine[] = [
    { label: `Fargate · ${s.vcpu} vCPU, ${s.gb} GB, always on`, monthly: fargateMonthly(s.id) },
    { label: "Network load balancer", monthly: round((AWS.nlbHour + AWS.nlcuHour) * HOURS_PER_MONTH) },
    { label: "Public IPv4 × 3", monthly: round(3 * AWS.ipv4Hour * HOURS_PER_MONTH) },
    { label: `EFS · ${o.storageGb} GB standard`, monthly: round(o.storageGb * AWS.efsGbMonth) },
    { label: "CloudWatch logs", monthly: AWS.logsMonth },
    { label: "ECR image storage", monthly: round(AWS.imageGb * AWS.ecrGbMonth) },
    { label: "Certificate (ACM)", monthly: 0 },
  ];
  const total = round(lines.reduce((a, l) => a + l.monthly, 0));
  const note = o.region === AWS.region
    ? `Estimate from AWS public on-demand prices for ${AWS.region} (${PRICES_AS_OF}). AWS bills you directly, and your bill is the real number.`
    : `Estimate from AWS public on-demand prices for ${AWS.region} (${PRICES_AS_OF}); ${o.region} can differ by a few percent. AWS bills you directly, and your bill is the real number.`;
  return { lines, total, note };
}
