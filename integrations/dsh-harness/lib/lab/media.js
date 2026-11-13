/**
 * DSH 消息 → mbot 多模态内容项。
 *
 * DSH 的用户消息里图片是 `{ type: "image", attachment: { attachmentId, mediaType, bytes } }`，
 * 文件落盘在 `$DSH_HOME/attachments/v1/objects/<前两位>/<attachmentId>`（内容寻址、不可变）。
 * mbot 的回合入口接受 `metadata.content_items`，其中图片项形如：
 *
 *     { type: "image_url", image_url: { url: "" }, path: "<本地绝对路径>", mime_type: "image/png" }
 *
 * 注意**不要**把 base64 塞进 url：daemon 的 adapt_content_items_for_provider 会把 data URL
 * 从上下文里剥掉（只在当轮 API 调用时按 path 重新内联），所以只给 path 才是对的。
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");

/**
 * 去掉 `sha256:` 这类算法前缀 —— DSH 存的 attachmentId 形如
 * `sha256:70dd0c03…`，而磁盘布局是 `objects/<hex 前两位>/<hex>`。
 */
export function attachmentHex(attachmentId) {
	const raw = String(attachmentId ?? "").trim();
	if (!raw) return "";
	const cut = raw.lastIndexOf(":");
	return cut >= 0 ? raw.slice(cut + 1) : raw;
}

/** 附件在磁盘上的绝对路径（内容寻址）。 */
export function attachmentPath(attachmentId, dshHome = DSH_HOME) {
	const hex = attachmentHex(attachmentId);
	if (!hex) return "";
	return join(dshHome, "attachments", "v1", "objects", hex.slice(0, 2), hex);
}

/** 从一条消息里摘出图片块。 */
function imageBlocks(message) {
	const content = message?.content;
	if (!Array.isArray(content)) return [];
	return content.filter((block) => block && block.type === "image" && block.attachment);
}

/**
 * 收集本回合要带给 mbot 的图片内容项。
 *
 * @param {Array} messages 决策消息（只取用户真实输入的那些）
 * @param {{ dshHome?: string, log?: (m: string) => void }} [options]
 * @returns {Array} mbot 的 content_items（没有图片时为空数组）
 */
export function imageContentItems(messages, options = {}) {
	const items = [];
	const seen = new Set();
	for (const message of messages ?? []) {
		if (!message || message.role !== "user") continue;
		for (const block of imageBlocks(message)) {
			const ref = block.attachment ?? {};
			const id = String(ref.attachmentId ?? "").trim();
			if (!id || seen.has(id)) continue;
			seen.add(id);
			const path = attachmentPath(id, options.dshHome || DSH_HOME);
			if (!existsSync(path)) {
				options.log?.(`图片附件文件不存在，跳过：${path}`);
				continue;
			}
			items.push({
				type: "image_url",
				image_url: { url: "" },
				path,
				name: String(ref.name ?? ref.mediaType ?? "image"),
				mime_type: String(ref.mediaType ?? "image/png"),
				...(ref.bytes === undefined ? {} : { bytes: Number(ref.bytes) }),
			});
		}
	}
	return items;
}
