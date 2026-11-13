/**
 * smoke-media.mjs —— 图片转发链路的离线自检。
 *
 * 不需要 daemon，也不需要真的往界面贴图：造一条带 image 块的 DSH 用户消息，
 * 在临时 DSH_HOME 里放一个真实文件，检查 imageContentItems() 产出的 content_items
 * 是否符合 mbot 的约定（type=image_url、只给 path、不带 base64）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { imageContentItems } = await import("../lib/lab/media.js");

let failed = 0;
function check(name, ok, detail) {
	if (ok) {
		console.log(`✓ ${name}${detail ? ` · ${detail}` : ""}`);
	} else {
		failed += 1;
		console.log(`✗ ${name}${detail ? ` · ${detail}` : ""}`);
	}
}

/* 造一个临时 DSH_HOME：attachments/v1/objects/<前两位>/<id> */
const home = mkdtempSync(join(tmpdir(), "lab-media-"));
const hex = "7469edc8a70baba4f81f1c796a0d002f43f7acd5c5796a166a22dee34001a440";
const id = `sha256:${hex}`;  // DSH 实际给的 attachmentId 带算法前缀
const dir = join(home, "attachments", "v1", "objects", hex.slice(0, 2));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, hex), Buffer.from("89504e470d0a1a0a", "hex"));

const userMessage = {
	role: "user",
	source: { kind: "user" },
	content: [
		{ type: "text", text: "这张图里是什么？" },
		{ type: "image", attachment: { attachmentId: id, mediaType: "image/jpeg", bytes: 1234 } },
	],
};

const items = imageContentItems([userMessage], { dshHome: home });

check("摘出 1 张图片", items.length === 1, `${items.length} 条`);
check("类型是 image_url", items[0]?.type === "image_url", items[0]?.type);
check("url 为空（不带 base64）", items[0]?.image_url?.url === "", JSON.stringify(items[0]?.image_url));
check("sha256: 前缀被剥掉", items[0]?.path?.includes(hex), items[0]?.path?.slice(-12));
check("给了本地绝对路径", typeof items[0]?.path === "string" && items[0].path.startsWith(home), items[0]?.path?.slice(-24));
check("沿用 mediaType", items[0]?.mime_type === "image/jpeg", items[0]?.mime_type);
check("带上字节数", items[0]?.bytes === 1234, String(items[0]?.bytes));

/* 去重：同一条消息里同一个附件出现两次只算一张 */
const duplicated = { ...userMessage, content: [...userMessage.content, userMessage.content[1]] };
check("同一附件去重", imageContentItems([duplicated], { dshHome: home }).length === 1);

/* 文件不存在时跳过而不是抛错 */
const missing = {
	role: "user",
	source: { kind: "user" },
	content: [{ type: "image", attachment: { attachmentId: "ff".repeat(32), mediaType: "image/png" } }],
};
let logged = "";
const skipped = imageContentItems([missing], { dshHome: home, log: (m) => (logged += m) });
check("附件缺失时跳过", skipped.length === 0);
check("附件缺失时有日志", logged.includes("不存在"), logged.slice(0, 40));

/* 非用户消息（系统注入）里的图片不该带出去 */
const injected = { ...userMessage, source: { kind: "system-reminder" } };
check("只取用户消息的图片", imageContentItems([injected], { dshHome: home }).length === 1);

/* 纯文本消息不产生 content_items */
check("纯文本无图片", imageContentItems([{ role: "user", content: [{ type: "text", text: "hi" }] }], { dshHome: home }).length === 0);

rmSync(home, { recursive: true, force: true });

console.log(failed === 0 ? "\n全部通过" : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
