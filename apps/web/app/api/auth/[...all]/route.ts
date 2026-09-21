import { auth } from "../../../../lib/auth";
export const runtime = "nodejs";
export async function GET(request: Request) { return auth().handler(request); }
export async function POST(request: Request) { return auth().handler(request); }
