// The self-host wizard's AWS pieces: prices, answers, Terraform, the deploy pipeline,
// the permission check, and the hand-over envelope.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parse, parseDocument } from "yaml";
import { awsEstimate, fargateMonthly } from "../src/services/selfhost/prices.ts";
import { patch, missing, type Draft } from "../src/services/selfhost/store.ts";
import { DEPLOY_STEPS, deployYaml, permissionGroups, policyStatement, removeYaml, resourceList, terraform } from "../src/services/selfhost/aws.ts";
import { awsMessage, checkPermissions, type Run } from "../src/services/selfhost/connect.ts";
import { open, seal } from "../src/services/selfhost/transfer.ts";
import { checkPipelineYaml } from "../src/services/substeps.ts";

const draft = (over: Partial<Draft["config"]> = {}): Draft => ({
  id: "0123456789ab", cloud: "aws", step: 1, by: { id: 1, username: "admin" },
  connect: { mode: "profile", profile: "default", accessKeyId: "", secretAccessKey: "", identity: { arn: "arn:aws:iam::123456789012:user/ezp-deployer", account: "123456789012", name: "ezp-deployer" }, checked: null },
  config: { name: "ezpipeline", region: "us-east-1", adminEmail: "", size: "1", storageGb: 20, address: "lb", domain: "", staticIp: false, ...over },
  data: { mode: "move", bundleFile: "", bundlePass: "", history: "last50", pauseHere: true },
  deploy: null, createdAt: "", updatedAt: "",
});
const enc = (s: string) => `enc(${s})`;

describe("prices", () => {
  test("Fargate sizes match the published hourly prices over 730 hours", () => {
    assert.deepEqual(["0.5", "1", "2", "4"].map((s) => fargateMonthly(s as any)), [18.02, 36.04, 72.08, 144.16]);
  });
  test("the estimate adds up, and says it is one", () => {
    const e = awsEstimate({ size: "1", storageGb: 20, region: "us-east-1" });
    assert.equal(e.total, Math.round(e.lines.reduce((a, l) => a + l.monthly, 0) * 100) / 100);
    assert.equal(e.lines.find((l) => l.label.startsWith("Network"))!.monthly, 20.81);
    assert.equal(e.lines.find((l) => l.label.startsWith("EFS"))!.monthly, 6);
    assert.match(e.note, /Estimate/);
    assert.match(awsEstimate({ size: "1", storageGb: 20, region: "eu-west-1" }).note, /eu-west-1 can differ/);
  });
});

describe("answers", () => {
  test("bad names, regions, domains and keys are refused", () => {
    for (const body of [
      { config: { name: "Bad Name" } }, { config: { name: "x" } }, { config: { region: "mars-1" } },
      { config: { domain: "https://ci.example.com/path" } }, { config: { storageGb: 0 } }, { config: { adminEmail: "nope" } },
      { connect: { accessKeyId: "nope" } }, { connect: { profile: "a b" } },
    ]) assert.throws(() => patch(draft(), body, enc), (e: any) => e.status === 400, JSON.stringify(body));
  });
  test("a domain is cleaned, and a key's secret is stored encrypted", () => {
    const d = patch(draft(), { config: { domain: "https://CI.Example.com/" }, connect: { mode: "keys", accessKeyId: "AKIAABCDEFGHIJKLMNOP", secretAccessKey: "a".repeat(40) } }, enc);
    assert.equal(d.config.domain, "ci.example.com");
    assert.equal(d.connect.secretAccessKey, `enc(${"a".repeat(40)})`);
    assert.equal(d.connect.identity, null, "a new sign-in is checked again");
  });
  test("name and region are fixed once deployed", () => {
    const d = draft();
    d.deploy = {} as any;
    patch(d, { config: { name: "other", region: "eu-west-1" } }, enc);
    assert.equal(d.config.name, "ezpipeline");
    assert.equal(d.config.region, "us-east-1");
  });
  test("what is missing is said in words", () => {
    const d = draft({ address: "domain" });
    assert.match(missing(d).join(" "), /custom domain/);
    d.connect.identity = null;
    assert.match(missing(d).join(" "), /Connect an AWS account/);
  });
});

describe("terraform", () => {
  const tf = (d: Draft) => terraform({ draft: d, account: "123456789012", version: "2.0.0", statePath: "/data/selfhost/x/tf/terraform.tfstate" });
  test("single node: one task, never two at once", () => {
    const t = tf(draft());
    assert.match(t, /desired_count\s+= 1/);
    assert.match(t, /deployment_minimum_healthy_percent = 0/);
    assert.match(t, /deployment_maximum_percent\s+= 100/);
    assert.match(t, /encrypted\s+= true/);
    assert.match(t, /123456789012\.dkr\.ecr\.us-east-1\.amazonaws\.com\/ezpipeline:2\.0\.0/);
  });
  test("size, domain and static addresses reach the file", () => {
    const t = tf(draft({ size: "2", address: "domain", domain: "ci.example.com", staticIp: true }));
    assert.match(t, /cpu\s+= 2048/);
    assert.match(t, /memory\s+= 4096/);
    assert.match(t, /domain\s+= "ci\.example\.com"/);
    assert.match(t, /static\s+= true/);
  });
  test("braces in a path cannot become Terraform interpolation", () => {
    const t = terraform({ draft: draft(), account: "1", version: "2.0.0", statePath: "/x/${evil}/state" });
    assert.match(t, /"\/x\/\$\$\{evil\}\/state"/);
  });
  test("the resource list follows the answers", () => {
    const plain = resourceList(draft()).map((r) => r.label);
    assert.ok(!plain.includes("ACM certificate") && !plain.includes("Elastic IPs"));
    const all = resourceList(draft({ address: "domain", domain: "ci.example.com", staticIp: true })).map((r) => r.label);
    assert.ok(all.includes("ACM certificate") && all.includes("Elastic IPs"));
  });
});

describe("the deploy pipeline", () => {
  for (const d of [draft(), draft({ address: "domain", domain: "ci.example.com", staticIp: true })]) {
    test(`is a valid pipeline with the steps the wizard shows (${d.config.address})`, () => {
      const y = deployYaml(d, "11111111-2222-3333-4444-555555555555");
      assert.deepEqual(checkPipelineYaml(y, parseDocument), []);
      const doc = parse(y);
      assert.deepEqual(doc.steps.map((s: any) => s.name), [...DEPLOY_STEPS]);
      assert.equal(doc.id, "11111111-2222-3333-4444-555555555555");
      // ${NAME} is replaced by the runner, which quotes values with spaces: the scripts use bare $NAME.
      for (const s of doc.steps) assert.doesNotMatch(s.run, /\$\{(EZP_|AWS_)/, s.name);
    });
  }
  test("the remove pipeline destroys, and says so", () => {
    const y = removeYaml(draft(), "x-1");
    assert.deepEqual(checkPipelineYaml(y, parseDocument), []);
    assert.match(parse(y).steps[0].run, /terraform|tf destroy/);
  });
});

describe("permission check", () => {
  const fake = (results: Record<string, string>, fail?: string): Run => async (args) => {
    if (fail) return { ok: false, out: "", err: fail };
    if (args[1] === "simulate-principal-policy") {
      const names = args.slice(args.indexOf("--action-names") + 1);
      return { ok: true, out: JSON.stringify({ EvaluationResults: names.map((n) => ({ EvalActionName: n, EvalDecision: results[n] ?? "allowed" })) }), err: "" };
    }
    if (args[1] === "get-role") return { ok: true, out: JSON.stringify({ Role: { Arn: "arn:aws:iam::1:role/path/Deployer" } }), err: "" };
    return { ok: false, out: "", err: "unexpected" };
  };
  const who = { arn: "arn:aws:iam::123456789012:user/ezp-deployer", account: "123456789012", name: "ezp-deployer", expires: null };

  test("a denied action marks its group, and the statement grants exactly what is missing", async () => {
    const c = await checkPermissions(draft(), who, fake({ "elasticfilesystem:CreateFileSystem": "implicitDeny" }));
    const efs = c.groups.find((g) => g.id === "efs")!;
    assert.deepEqual(efs.denied, ["elasticfilesystem:CreateFileSystem"]);
    assert.ok(c.groups.filter((g) => g.id !== "efs").every((g) => !g.denied.length));
    assert.deepEqual(JSON.parse(policyStatement(efs.denied)).Action, ["elasticfilesystem:CreateFileSystem"]);
  });
  test("an assumed role is checked as the role", async () => {
    let asked = "";
    const run: Run = async (args, env) => { if (args[1] === "simulate-principal-policy") asked = args[args.indexOf("--policy-source-arn") + 1]; return fake({})(args, env); };
    await checkPermissions(draft(), { ...who, arn: "arn:aws:sts::1:assumed-role/Deployer/session" }, run);
    assert.equal(asked, "arn:aws:iam::1:role/path/Deployer");
  });
  test("the root user may do everything, and is told so", async () => {
    const c = await checkPermissions(draft(), { ...who, arn: "arn:aws:iam::1:root" }, fake({}, "never called"));
    assert.ok(c.groups.every((g) => !g.denied.length));
    assert.match(c.note!, /root user/);
  });
  test("no permission to simulate is said plainly, and does not block", async () => {
    const c = await checkPermissions(draft(), who, fake({}, "An error occurred (AccessDenied) when calling the SimulatePrincipalPolicy operation: User is not authorized"));
    assert.match(c.error!, /iam:SimulatePrincipalPolicy/);
  });
  test("Elastic IPs and certificates are only needed when asked for", () => {
    assert.ok(!permissionGroups(draft()).find((g) => g.id === "eip")!.needed);
    assert.ok(permissionGroups(draft({ staticIp: true })).find((g) => g.id === "eip")!.needed);
    assert.ok(permissionGroups(draft({ address: "domain", domain: "a.b.co" })).find((g) => g.id === "acm")!.needed);
  });
  test("AWS's message is kept, without the CLI's preamble", () => {
    assert.equal(awsMessage("\nAn error occurred (ExpiredToken) when calling the GetCallerIdentity operation: The security token included in the request is expired\n"), "The security token included in the request is expired (ExpiredToken)");
  });
});

describe("hand-over envelope", () => {
  test("opens with the same token only", () => {
    const e = seal("token-a", Buffer.from("hello"));
    assert.equal(open("token-a", e)!.toString(), "hello");
    assert.equal(open("token-b", e), null);
  });
  test("a changed byte is refused", () => {
    const e = seal("t", Buffer.from("hello"));
    e[e.length - 1] ^= 1;
    assert.equal(open("t", e), null);
    assert.equal(open("t", Buffer.from("not an envelope at all, but long enough to read the header")), null);
  });
});
