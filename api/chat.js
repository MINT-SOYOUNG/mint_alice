/**
 * POST /api/chat — 양소영 포트폴리오 "AI 프로젝트 상담 도우미"
 *
 * Vercel Serverless Function (Node.js 18+, CommonJS, 외부 패키지 없음)
 *
 * 동작
 *  - 환경변수 OPENAI_API_KEY 가 있으면      → OpenAI Chat Completions 호출 (mode: "gpt")
 *  - 키가 없거나 호출이 실패하면            → 사이트 안내용 기본 응답 (mode: "fallback")
 *    (키 미설정 상태에서도 500 대신 200 + 안내 문구를 돌려주므로 챗봇이 멈추지 않습니다)
 *
 * 요청  : POST /api/chat  { "messages": [ { "role": "user" | "assistant", "content": "..." } ] }
 * 응답  : 200 { "mode": "gpt" | "fallback", "reply": "...", "model"?: "...", "suggestions"?: [...] }
 */

const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const MAX_MESSAGES = 16; // 최근 대화만 전달
const MAX_CONTENT_CHARS = 2000; // 메시지 1건 최대 길이
const MAX_TOTAL_CHARS = 8000;
const UPSTREAM_TIMEOUT_MS = 20000;

// 공개 주소이므로 남용(과금)을 막기 위한 최소한의 완충. 인스턴스 단위로만 동작한다.
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 30 };
const rateHits = new Map();

/* ------------------------------------------------------------------ *
 * 상담 기준 정보 (사이트 마크업의 About/Contact 내용과 동일하게 유지)
 * ------------------------------------------------------------------ */
const PROFILE = {
    name: "양소영",
    role: "웹퍼블리셔 · 그래픽 디자이너",
    email: "bluehanavi@gmail.com",
    phone: "010-2593-1131",
    license: "웹디자인기능사",
    skills: {
        "웹퍼블리싱": "HTML / CSS / jQuery (반응형 마크업, 크로스브라우징)",
        "쇼핑몰": "카페24 스킨 퍼블리싱 · 수정, 상품 상세페이지",
        "2D 그래픽": "Photoshop / Illustrator (상세페이지·배너·SNS 이미지)",
        "영상": "After Effects / Premiere (영상 편집·모션그래픽)",
    },
};

const SYSTEM_PROMPT = [
    `너는 디자이너 ${PROFILE.name}의 포트폴리오 사이트에서 프로젝트 문의를 돕는 'AI 프로젝트 상담 도우미'다.`,
    `소개: ${PROFILE.role}. 보유 자격: ${PROFILE.license}.`,
    `작업 범위: ${Object.entries(PROFILE.skills).map(([k, v]) => `${k}(${v})`).join(", ")}.`,
    `연락처: 이메일 ${PROFILE.email}, 전화 ${PROFILE.phone}, 사이트 하단 Contact 폼.`,
    "",
    "답변 원칙:",
    "1. 한국어 존댓말로, 3~5문장 이내로 짧고 실무적으로 답한다.",
    "2. 작업 범위, 진행 절차, 준비물, 견적·일정 문의 방법, 포트폴리오 작업물에 대해서만 답한다.",
    "3. 확인되지 않은 정보는 만들지 않는다. 구체적인 금액, 할인, 확정 일정, 진행 중인 프로젝트의 내부 사정, 경력 연차는 절대 지어내지 말고 '상담 후 안내드린다'고 말한다.",
    "4. 견적·일정은 작업 범위(페이지 수, 이미지 수, 영상 길이, 수정 횟수)에 따라 달라진다고 설명하고, 필요한 정보(프로젝트 종류, 분량, 희망 마감일)를 되묻는다.",
    "5. 범위 밖의 질문(정치, 의료, 코딩 대행 등)은 정중히 사양하고 문의 채널을 안내한다.",
    "6. 이모지는 쓰지 않고, 목록이 필요하면 '·' 또는 줄바꿈으로 정리한다.",
].join("\n");

/* ------------------------------------------------------------------ *
 * 기본(폴백) 안내 — 키가 없어도 챗봇이 유용하게 답하도록 만든 키워드 응답
 * ------------------------------------------------------------------ */
const CONTACT_LINE =
    `이메일 ${PROFILE.email} 또는 전화 ${PROFILE.phone}로 문의하실 수 있고, 사이트 하단 'Contact Me' 폼도 같은 메일로 연결됩니다.`;

const FALLBACK_TOPICS = [
    {
        key: "scope",
        test: /(분야|범위|뭘|무엇|뭐|할 수|가능|업무|작업 종류|서비스|스킬|기술|툴|프로그램)/,
        reply: [
            "작업 분야는 크게 네 가지입니다.",
            `· 웹퍼블리싱 — ${PROFILE.skills["웹퍼블리싱"]}`,
            `· 쇼핑몰 — ${PROFILE.skills["쇼핑몰"]}`,
            `· 2D 그래픽 — ${PROFILE.skills["2D 그래픽"]}`,
            `· 영상 — ${PROFILE.skills["영상"]}`,
            "원하시는 프로젝트 종류를 알려주시면 그에 맞춰 안내드리겠습니다.",
        ].join("\n"),
        suggestions: ["진행 절차와 기간", "견적 문의 방법", "작업물 보기"],
    },
    {
        key: "process",
        test: /(절차|과정|진행|순서|일정|기간|얼마나|언제|납기|마감)/,
        reply: [
            "진행은 보통 다섯 단계입니다.",
            "· 1) 문의와 요구사항 정리 — 목적, 분량, 참고 사이트·이미지",
            "· 2) 견적과 일정 안내 — 범위를 확인한 뒤 확정",
            "· 3) 시안 또는 퍼블리싱 진행 — 중간 확인 후 다음 단계로",
            "· 4) 수정 반영 — 협의한 횟수만큼 조정",
            "· 5) 납품과 간단한 사용 안내",
            "기간은 페이지 수, 이미지 분량, 영상 길이에 따라 달라지므로 희망 마감일과 분량을 알려주시면 상담 후 정확히 안내드립니다.",
        ].join("\n"),
        suggestions: ["작업 가능 분야", "견적 문의 방법"],
    },
    {
        key: "quote",
        test: /(견적|비용|가격|얼마|금액|단가|예산|할인|결제|계약)/,
        reply: [
            "견적은 작업 내용을 확인한 뒤 안내드립니다. 페이지 수, 이미지·영상 분량, 수정 횟수에 따라 금액이 달라져서입니다.",
            "아래 세 가지만 알려주시면 견적을 빠르게 드릴 수 있습니다.",
            "· 프로젝트 종류(상세페이지, 카페24 스킨, 배너·SNS 이미지, 영상 편집 등)",
            "· 분량(페이지 수, 이미지 장수, 영상 길이)",
            "· 희망 마감일",
            CONTACT_LINE,
        ].join("\n"),
        suggestions: ["진행 절차와 기간", "포함되는 수정 횟수"],
    },
    {
        key: "cafe24",
        test: /(카페24|cafe24|쇼핑몰|스킨|상세페이지|상품)/,
        reply: [
            "카페24 쇼핑몰 작업은 스킨 퍼블리싱과 수정, 상품 상세페이지 디자인 모두 가능합니다.",
            "스킨은 HTML/CSS/jQuery로 반응형까지 맞춰 작업하고, 상세페이지는 Photoshop·Illustrator로 디자인한 뒤 카페24 편집 기준에 맞춰 이미지를 잘라 올립니다.",
            "현재 쓰고 계신 스킨 종류와 수정하실 화면(메인, 상품, 장바구니 등)을 알려주시면 범위를 정리해 드리겠습니다.",
            CONTACT_LINE,
        ].join("\n"),
        suggestions: ["진행 절차와 기간", "견적 문의 방법"],
    },
    {
        key: "video",
        test: /(영상|동영상|프리미어|에펙|애프터|after|premiere|모션|편집)/,
        reply: [
            "영상 작업은 Premiere로 편집하고, 필요한 경우 After Effects로 자막·모션을 얹습니다.",
            "홍보 영상, 제품 소개, 짧은 쇼츠 형태 모두 상담 가능합니다.",
            "원본 소재 보유 여부와 영상 길이, 희망 납기일을 알려주시면 진행 방식을 정리해 드리겠습니다.",
            CONTACT_LINE,
        ].join("\n"),
        suggestions: ["진행 절차와 기간", "작업 가능 분야"],
    },
    {
        key: "web",
        test: /(웹|퍼블리싱|html|css|jquery|반응형|홈페이지|랜딩|사이트)/,
        reply: [
            "웹퍼블리싱은 HTML/CSS/jQuery로 반응형 마크업까지 작업합니다.",
            "디자인 시안이 이미 있으면 그대로 퍼블리싱하고, 없으면 레이아웃 정리부터 함께 진행합니다.",
            "페이지 수와 참고 사이트, 반응형 필요 범위를 알려주시면 일정과 견적을 안내드리겠습니다.",
            CONTACT_LINE,
        ].join("\n"),
        suggestions: ["진행 절차와 기간", "견적 문의 방법"],
    },
    {
        key: "portfolio",
        test: /(포트폴리오|작업물|실적|경력|샘플|자격|기능사)/,
        reply: [
            "포트폴리오는 이 페이지의 'Portfolio' 영역에서 보실 수 있습니다. 상품 상세페이지와 그래픽 작업물을 올려 두었습니다.",
            `보유 자격은 ${PROFILE.license}이고, 현재 그래픽디자인 실기 자격도 준비하고 있습니다.`,
            "찾으시는 작업 종류를 알려주시면 그와 비슷한 사례를 메일로 정리해 보내드릴 수 있습니다.",
            CONTACT_LINE,
        ].join("\n"),
        suggestions: ["작업 가능 분야", "견적 문의 방법"],
    },
    {
        key: "contact",
        test: /(연락|문의|메일|이메일|전화|카톡|카카오|상담|어떻게|연결)/,
        reply: [
            CONTACT_LINE,
            "메일로 보내실 때는 프로젝트 종류, 분량, 희망 마감일, 참고 이미지나 사이트를 함께 적어주시면 상담이 빨라집니다.",
            "전화는 통화가 어려울 때 문자를 남겨주시면 확인 후 연락드립니다.",
        ].join("\n"),
        suggestions: ["작업 가능 분야", "진행 절차와 기간"],
    },
    {
        key: "greeting",
        test: /^(안녕|하이|hello|hi|반가|어떻게 지내)/i,
        reply: [
            `안녕하세요. 디자이너 ${PROFILE.name}의 AI 프로젝트 상담 도우미입니다.`,
            "작업 분야, 진행 절차와 기간, 견적 문의 방법을 안내해 드릴 수 있습니다.",
            "궁금하신 점을 편하게 적어주세요.",
        ].join("\n"),
        suggestions: ["작업 가능 분야", "진행 절차와 기간", "견적 문의 방법"],
    },
];

const DEFAULT_REPLY = [
    `디자이너 ${PROFILE.name}의 AI 프로젝트 상담 도우미입니다.`,
    "작업 분야(웹퍼블리싱·카페24·상세페이지·그래픽·영상), 진행 절차와 기간, 견적 문의 방법을 안내해 드립니다.",
    "아래 질문 버튼을 누르시거나 궁금한 점을 직접 적어주세요.",
    CONTACT_LINE,
].join("\n");

function pickFallback(text) {
    const q = String(text || "").trim();
    if (!q) {
        return { reply: DEFAULT_REPLY, suggestions: ["작업 가능 분야", "진행 절차와 기간", "견적 문의 방법"] };
    }
    const hit = FALLBACK_TOPICS.find((t) => t.test.test(q));
    if (hit) return { reply: hit.reply, suggestions: hit.suggestions };
    return { reply: DEFAULT_REPLY, suggestions: ["작업 가능 분야", "진행 절차와 기간", "견적 문의 방법"] };
}

/* ------------------------------------------------------------------ *
 * 유틸리티
 * ------------------------------------------------------------------ */
function clientKey(req) {
    const headers = (req && req.headers) || {};
    const raw = headers["x-forwarded-for"] || headers["x-real-ip"] || headers["X-Forwarded-For"] || "";
    const first = String(raw).split(",")[0].trim();
    return first || "unknown";
}

function isRateLimited(req) {
    const key = clientKey(req);
    const now = Date.now();
    const entry = rateHits.get(key) || { count: 0, start: now };
    if (now - entry.start > RATE_LIMIT.windowMs) {
        entry.count = 0;
        entry.start = now;
    }
    entry.count += 1;
    rateHits.set(key, entry);
    if (rateHits.size > 5000) rateHits.clear();
    return entry.count > RATE_LIMIT.max;
}
function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    if (res && typeof res.status === "function" && typeof res.json === "function") {
        res.status(statusCode).json(payload);
        return;
    }
    if (res) {
        res.statusCode = statusCode;
        if (typeof res.setHeader === "function") {
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-store");
        }
        res.end(body);
    }
}

async function readJsonBody(req) {
    if (req && req.body && typeof req.body === "object") return req.body;
    if (req && typeof req.body === "string" && req.body.length) {
        try {
            return JSON.parse(req.body);
        } catch (e) {
            return {};
        }
    }
    if (!req || typeof req.on !== "function") return {};

    const raw = await new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk;
            if (data.length > 1e6) {
                reject(new Error("payload_too_large"));
            }
        });
        req.on("end", () => resolve(data));
        req.on("error", reject);
    });

    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch (e) {
        return {};
    }
}

/** 들어온 대화를 OpenAI에 보낼 수 있는 형태로 정리한다. */
function normalizeMessages(input) {
    const list = Array.isArray(input) ? input : [];
    const cleaned = [];
    for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
        if (!role) continue;
        const content = String(item.content == null ? "" : item.content).slice(0, MAX_CONTENT_CHARS).trim();
        if (!content) continue;
        cleaned.push({ role, content });
    }
    // 최근 메시지만 남기되, 대화가 user로 시작하도록 정리
    let recent = cleaned.slice(-MAX_MESSAGES);
    while (recent.length && recent[0].role !== "user") recent.shift();

    // 전체 길이 제한
    let total = 0;
    const bounded = [];
    for (let i = recent.length - 1; i >= 0; i -= 1) {
        const m = recent[i];
        total += m.content.length;
        if (total > MAX_TOTAL_CHARS && bounded.length) break;
        bounded.unshift(m);
    }
    return bounded;
}

async function callOpenAI(apiKey, messages) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS) : null;

    try {
        const response = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: DEFAULT_MODEL,
                messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
                temperature: 0.4,
                max_tokens: 500,
            }),
            signal: controller ? controller.signal : undefined,
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            const err = new Error(`openai_http_${response.status}`);
            err.detail = detail.slice(0, 300);
            err.status = response.status;
            throw err;
        }

        const data = await response.json();
        const reply =
            data && data.choices && data.choices[0] && data.choices[0].message
                ? String(data.choices[0].message.content || "").trim()
                : "";
        if (!reply) {
            const err = new Error("openai_empty_reply");
            throw err;
        }
        return reply;
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/* ------------------------------------------------------------------ *
 * 핸들러
 * ------------------------------------------------------------------ */
module.exports = async function handler(req, res) {
    if (req && req.method && req.method !== "POST") {
        sendJson(res, 405, {
            mode: "fallback",
            error: "method_not_allowed",
            reply: "이 주소는 POST 요청만 처리합니다.",
        });
        return;
    }

    if (isRateLimited(req)) {
        sendJson(res, 429, {
            mode: "fallback",
            reason: "rate_limited",
            reply: "문의가 잠시 몰려 답변이 지연되고 있습니다. 잠시 후 다시 시도하시거나 " +
                `${PROFILE.email} 으로 문의해 주세요.`,
        });
        return;
    }

    let body = {};
    try {
        body = (await readJsonBody(req)) || {};
    } catch (e) {
        body = {};
    }

    const messages = normalizeMessages(body.messages);
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = lastUser ? lastUser.content : "";
    const fallback = pickFallback(question);
    const apiKey = typeof process !== "undefined" && process.env ? process.env.OPENAI_API_KEY : "";

    // 1) 키가 없으면 안내 모드
    if (!apiKey) {
        sendJson(res, 200, {
            mode: "fallback",
            reason: "no_api_key",
            reply: fallback.reply,
            suggestions: fallback.suggestions,
        });
        return;
    }

    if (!question) {
        sendJson(res, 200, {
            mode: "fallback",
            reason: "empty_question",
            reply: fallback.reply,
            suggestions: fallback.suggestions,
        });
        return;
    }

    // 2) 키가 있으면 GPT 응답, 실패하면 안내 모드로 되돌아간다
    try {
        const reply = await callOpenAI(apiKey, messages);
        sendJson(res, 200, { mode: "gpt", model: DEFAULT_MODEL, reply });
    } catch (err) {
        const status = err && err.status;
        sendJson(res, 200, {
            mode: "fallback",
            reason: status ? `openai_${status}` : (err && err.message) || "openai_error",
            reply: fallback.reply,
            suggestions: fallback.suggestions,
        });
    }
};
