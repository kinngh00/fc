import { upsertAdminUser } from "../server/community-service.mjs";

const loginId = process.env.FC_CREATE_ADMIN_LOGIN_ID;
const password = process.env.FC_CREATE_ADMIN_PASSWORD;
if (!loginId || !password) throw new Error("FC_CREATE_ADMIN_LOGIN_ID와 FC_CREATE_ADMIN_PASSWORD가 필요합니다.");
const userId = await upsertAdminUser({ loginId, password });
console.log(`관리자 계정이 준비되었습니다. userId=${userId}`);
