import fs from "fs";
import { NextApiRequest, NextApiResponse } from "next";
import os from "os";
import path from "path";

function getStardewSavesPath(): string {
	if (os.platform() === "win32") {
		const appData =
			process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
		return path.join(appData, "StardewValley", "Saves");
	}
	return path.join(os.homedir(), ".config", "StardewValley", "Saves");
}

/** Validates a save directory name to prevent path traversal. */
function isValidSaveName(name: string): boolean {
	return /^[A-Za-z0-9_\- ]+$/.test(name) && !name.includes("..");
}

async function listSaves(res: NextApiResponse) {
	const savesPath = getStardewSavesPath();

	if (!fs.existsSync(savesPath)) {
		return res
			.status(404)
			.json({ error: "Stardew Valley saves folder not found.", savesPath });
	}

	const entries = fs.readdirSync(savesPath, { withFileTypes: true });
	const saves = entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => fs.existsSync(path.join(savesPath, name, name)));

	return res.json({ saves, savesPath });
}

async function loadSave(req: NextApiRequest, res: NextApiResponse) {
	const body =
		typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body;
	const { saveName } = body ?? {};

	if (!saveName || typeof saveName !== "string" || !isValidSaveName(saveName)) {
		return res.status(400).json({ error: "Invalid save name." });
	}

	const savesPath = getStardewSavesPath();
	const filePath = path.join(savesPath, saveName, saveName);

	if (!fs.existsSync(filePath)) {
		return res.status(404).json({ error: "Save file not found." });
	}

	const content = fs.readFileSync(filePath, "utf-8");
	res.setHeader("Content-Type", "text/plain; charset=utf-8");
	return res.send(content);
}

export default async function handler(
	req: NextApiRequest,
	res: NextApiResponse,
) {
	// Only available when running in development / local mode
	if (!parseInt(process.env.NEXT_PUBLIC_DEVELOPMENT ?? "0")) {
		return res.status(404).end();
	}

	try {
		switch (req.method) {
			case "GET":
				return await listSaves(res);
			case "POST":
				return await loadSave(req, res);
			default:
				return res.status(405).end();
		}
	} catch (e: any) {
		return res.status(500).json({ error: e?.message ?? "Unknown error." });
	}
}
