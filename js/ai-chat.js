/*!
 * ai-chat.js — 포트폴리오 "AI 프로젝트 상담 도우미" 위젯
 *
 * · 의존성 없음(바닐라 JS). jQuery/Bootstrap 위에서 그대로 동작합니다.
 * · POST /api/chat (Vercel 서버리스 함수)으로 대화를 보냅니다.
 * · 로컬 정적 서버처럼 /api/chat 이 없는 환경에서도, 서버 오류·시간 초과 시에도
 *   같은 내용의 기본 안내를 브라우저에서 바로 만들어 답합니다.
 */
(function () {
    "use strict";

    var container = document.getElementById("ai-chat");
    if (!container) return;

    var toggleBtn = document.getElementById("aiChatToggle");
    var panel = document.getElementById("aiChatPanel");
    var closeBtn = document.getElementById("aiChatClose");
    var log = document.getElementById("aiChatLog");
    var form = document.getElementById("aiChatForm");
    var input = document.getElementById("aiChatInput");
    var sendBtn = document.getElementById("aiChatSend");
    var quickWrap = document.getElementById("aiChatQuick");

    var PROFILE = {
        name: "양소영",
        email: "bluehanavi@gmail.com",
        phone: "010-2593-1131"
    };
    var CONTACT_LINE = "이메일 " + PROFILE.email + " 또는 전화 " + PROFILE.phone +
        "로 문의하실 수 있고, 사이트 하단 'Contact Me' 폼도 같은 메일로 연결됩니다.";
    var DEFAULT_SUGGESTIONS = ["작업 가능 분야", "진행 절차와 기간", "견적 문의 방법"];

    var history = [];          // [{role:"user"|"assistant", content:"..."}]
    var greeted = false;
    var sending = false;
    var requestTimer = null;
    var abortCtrl = null;

    /* ---------- 브라우저 쪽 기본 안내(서버 응답이 없을 때) ---------- */
    var LOCAL_TOPICS = [
        {
            test: /(분야|범위|뭘|무엇|뭐|할 수|가능|업무|작업 종류|서비스|스킬|기술|툴|프로그램)/,
            reply: [
                "작업 분야는 크게 네 가지입니다.",
                "· 웹퍼블리싱 — HTML / CSS / jQuery 반응형 마크업",
                "· 쇼핑몰 — 카페24 스킨 퍼블리싱·수정, 상품 상세페이지",
                "· 2D 그래픽 — Photoshop / Illustrator (상세페이지·배너·SNS 이미지)",
                "· 영상 — After Effects / Premiere (편집·모션그래픽)",
                "원하시는 프로젝트 종류를 알려주시면 그에 맞춰 안내드리겠습니다."
            ].join("\n"),
            suggestions: ["진행 절차와 기간", "견적 문의 방법", "작업물 보기"]
        },
        {
            test: /(절차|과정|진행|순서|일정|기간|얼마나|언제|납기|마감)/,
            reply: [
                "진행은 보통 다섯 단계입니다.",
                "· 1) 문의와 요구사항 정리 — 목적, 분량, 참고 사이트·이미지",
                "· 2) 견적과 일정 안내 — 범위를 확인한 뒤 확정",
                "· 3) 시안 또는 퍼블리싱 진행 — 중간 확인 후 다음 단계로",
                "· 4) 수정 반영 — 협의한 횟수만큼 조정",
                "· 5) 납품과 간단한 사용 안내",
                "기간은 페이지 수, 이미지 분량, 영상 길이에 따라 달라지므로 희망 마감일과 분량을 알려주시면 상담 후 정확히 안내드립니다."
            ].join("\n"),
            suggestions: ["작업 가능 분야", "견적 문의 방법"]
        },
        {
            test: /(견적|비용|가격|얼마|금액|단가|예산|할인|결제|계약)/,
            reply: [
                "견적은 작업 내용을 확인한 뒤 안내드립니다. 페이지 수, 이미지·영상 분량, 수정 횟수에 따라 금액이 달라져서입니다.",
                "아래 세 가지만 알려주시면 견적을 빠르게 드릴 수 있습니다.",
                "· 프로젝트 종류(상세페이지, 카페24 스킨, 배너·SNS 이미지, 영상 편집 등)",
                "· 분량(페이지 수, 이미지 장수, 영상 길이)",
                "· 희망 마감일",
                CONTACT_LINE
            ].join("\n"),
            suggestions: ["진행 절차와 기간", "작업 가능 분야"]
        },
        {
            test: /(카페24|cafe24|쇼핑몰|스킨|상세페이지|상품)/,
            reply: [
                "카페24 쇼핑몰 작업은 스킨 퍼블리싱과 수정, 상품 상세페이지 디자인 모두 가능합니다.",
                "스킨은 HTML/CSS/jQuery로 반응형까지 맞춰 작업하고, 상세페이지는 Photoshop·Illustrator로 디자인한 뒤 카페24 편집 기준에 맞춰 이미지를 잘라 올립니다.",
                "현재 쓰고 계신 스킨 종류와 수정하실 화면을 알려주시면 범위를 정리해 드리겠습니다.",
                CONTACT_LINE
            ].join("\n"),
            suggestions: ["진행 절차와 기간", "견적 문의 방법"]
        },
        {
            test: /(영상|동영상|프리미어|에펙|애프터|after|premiere|모션|편집)/,
            reply: [
                "영상 작업은 Premiere로 편집하고, 필요한 경우 After Effects로 자막·모션을 얹습니다.",
                "홍보 영상, 제품 소개, 짧은 쇼츠 형태 모두 상담 가능합니다.",
                "원본 소재 보유 여부와 영상 길이, 희망 납기일을 알려주시면 진행 방식을 정리해 드리겠습니다.",
                CONTACT_LINE
            ].join("\n"),
            suggestions: ["진행 절차와 기간", "작업 가능 분야"]
        },
        {
            test: /(웹|퍼블리싱|html|css|jquery|반응형|홈페이지|랜딩|사이트)/,
            reply: [
                "웹퍼블리싱은 HTML/CSS/jQuery로 반응형 마크업까지 작업합니다.",
                "디자인 시안이 이미 있으면 그대로 퍼블리싱하고, 없으면 레이아웃 정리부터 함께 진행합니다.",
                "페이지 수와 참고 사이트, 반응형 필요 범위를 알려주시면 일정과 견적을 안내드리겠습니다.",
                CONTACT_LINE
            ].join("\n"),
            suggestions: ["진행 절차와 기간", "견적 문의 방법"]
        },
        {
            test: /(포트폴리오|작업물|실적|경력|샘플|자격|기능사)/,
            reply: [
                "포트폴리오는 이 페이지의 'Portfolio' 영역에서 보실 수 있습니다. 상품 상세페이지와 그래픽 작업물을 올려 두었습니다.",
                "보유 자격은 웹디자인기능사입니다.",
                "찾으시는 작업 종류를 알려주시면 그와 비슷한 사례를 메일로 정리해 보내드릴 수 있습니다.",
                CONTACT_LINE
            ].join("\n"),
            suggestions: ["작업 가능 분야", "견적 문의 방법"]
        },
        {
            test: /(연락|문의|메일|이메일|전화|카톡|카카오|상담|어떻게|연결)/,
            reply: [
                CONTACT_LINE,
                "메일로 보내실 때는 프로젝트 종류, 분량, 희망 마감일, 참고 이미지나 사이트를 함께 적어주시면 상담이 빨라집니다.",
                "전화는 통화가 어려울 때 문자를 남겨주시면 확인 후 연락드립니다."
            ].join("\n"),
            suggestions: ["작업 가능 분야", "진행 절차와 기간"]
        }
    ];

    var LOCAL_DEFAULT = [
        "디자이너 " + PROFILE.name + "의 AI 프로젝트 상담 도우미입니다.",
        "작업 분야(웹퍼블리싱·카페24·상세페이지·그래픽·영상), 진행 절차와 기간, 견적 문의 방법을 안내해 드립니다.",
        "아래 질문 버튼을 누르시거나 궁금한 점을 직접 적어주세요.",
        CONTACT_LINE
    ].join("\n");

    function localAnswer(text) {
        var q = String(text || "").trim();
        if (!q) return { reply: LOCAL_DEFAULT, suggestions: DEFAULT_SUGGESTIONS };
        for (var i = 0; i < LOCAL_TOPICS.length; i += 1) {
            if (LOCAL_TOPICS[i].test.test(q)) {
                return { reply: LOCAL_TOPICS[i].reply, suggestions: LOCAL_TOPICS[i].suggestions };
            }
        }
        if (/^(안녕|하이|hello|hi|반가)/i.test(q)) {
            return {
                reply: "안녕하세요. 디자이너 " + PROFILE.name + "의 AI 프로젝트 상담 도우미입니다.\n" +
                    "작업 분야, 진행 절차와 기간, 견적 문의 방법을 안내해 드릴 수 있습니다.\n궁금하신 점을 편하게 적어주세요.",
                suggestions: DEFAULT_SUGGESTIONS
            };
        }
        return { reply: LOCAL_DEFAULT, suggestions: DEFAULT_SUGGESTIONS };
    }

    /* ---------- 화면 그리기 ---------- */
    function scrollToBottom() {
        if (log) log.scrollTop = log.scrollHeight;
    }

    function addBubble(role, text) {
        var row = document.createElement("div");
        row.className = "ai-chat-row ai-chat-row-" + role;

        var bubble = document.createElement("div");
        bubble.className = "ai-chat-bubble ai-chat-bubble-" + role;
        bubble.textContent = text;   // 사용자 입력을 HTML로 해석하지 않는다

        row.appendChild(bubble);
        log.appendChild(row);
        scrollToBottom();
        return row;
    }

    function addTyping() {
        var row = document.createElement("div");
        row.className = "ai-chat-row ai-chat-row-bot";
        row.setAttribute("data-typing", "1");
        row.innerHTML = '<div class="ai-chat-bubble ai-chat-bubble-bot ai-chat-typing" aria-label="답변 작성 중">' +
            "<span></span><span></span><span></span></div>";
        log.appendChild(row);
        scrollToBottom();
        return row;
    }

    function setQuick(list) {
        if (!quickWrap) return;
        var items = (list && list.length ? list : []).slice(0, 4);
        quickWrap.innerHTML = "";
        items.forEach(function (label) {
            var b = document.createElement("button");
            b.type = "button";
            b.className = "ai-chat-chip";
            b.textContent = label;
            b.addEventListener("click", function () {
                ask(label);
            });
            quickWrap.appendChild(b);
        });
    }

    function setBusy(state) {
        sending = state;
        if (sendBtn) sendBtn.disabled = state;
        if (input) input.disabled = state;
        container.classList.toggle("ai-chat-busy", state);
    }

    function openPanel() {
        container.classList.add("ai-chat-open");
        document.body.classList.add("ai-chat-open");
        toggleBtn.setAttribute("aria-expanded", "true");
        panel.hidden = false;

        if (!greeted) {
            greeted = true;
            addBubble("bot",
                "안녕하세요. 디자이너 " + PROFILE.name + "의 AI 프로젝트 상담 도우미입니다.\n" +
                "작업 분야, 진행 절차와 기간, 견적 문의 방법을 안내해 드립니다.\n" +
                "아래 질문 버튼을 누르시거나 궁금한 점을 직접 적어주세요.");
            setQuick(DEFAULT_SUGGESTIONS);
        }
        window.setTimeout(function () {
            if (input) input.focus({ preventScroll: true });
            scrollToBottom();
        }, 80);
    }

    function closePanel() {
        container.classList.remove("ai-chat-open");
        document.body.classList.remove("ai-chat-open");
        toggleBtn.setAttribute("aria-expanded", "false");
        panel.hidden = true;
        toggleBtn.focus({ preventScroll: true });
    }

    function togglePanel() {
        if (container.classList.contains("ai-chat-open")) closePanel();
        else openPanel();
    }

    /* ---------- 서버 호출 ---------- */
    function askServer(messages) {
        if (typeof fetch !== "function") return Promise.reject(new Error("no_fetch"));

        abortCtrl = typeof AbortController === "function" ? new AbortController() : null;
        requestTimer = window.setTimeout(function () {
            if (abortCtrl) abortCtrl.abort();
        }, 25000);

        return fetch("api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: messages }),
            signal: abortCtrl ? abortCtrl.signal : undefined
        }).then(function (res) {
            if (!res.ok) throw new Error("http_" + res.status);
            return res.json();
        }).then(function (data) {
            if (!data || typeof data.reply !== "string" || !data.reply.trim()) {
                throw new Error("bad_payload");
            }
            return data;
        });
    }

    function finishRequest() {
        if (requestTimer) {
            window.clearTimeout(requestTimer);
            requestTimer = null;
        }
        abortCtrl = null;
    }

    function ask(text) {
        var q = String(text == null ? "" : text).trim();
        if (!q || sending) return;

        openPanel();
        addBubble("user", q);
        history.push({ role: "user", content: q });

        if (input) {
            input.value = "";
            autoGrow();
        }
        setQuick([]);            // 대화 중에는 빠른 질문 버튼을 잠시 감춘다
        setBusy(true);
        var typing = addTyping();

        askServer(history.slice(-12))
            .then(function (data) {
                var reply = data.reply;
                var suggestions = data.suggestions;
                if (data.mode !== "gpt" && (!suggestions || !suggestions.length)) {
                    suggestions = localAnswer(q).suggestions;
                }
                return { reply: reply, suggestions: suggestions, degraded: data.mode !== "gpt" };
            })
            .catch(function () {
                // 서버가 없거나 응답이 없을 때: 같은 내용을 브라우저에서 만들어 답한다
                var fb = localAnswer(q);
                return { reply: fb.reply, suggestions: fb.suggestions, degraded: true };
            })
            .then(function (result) {
                finishRequest();
                if (typing && typing.parentNode) typing.parentNode.removeChild(typing);
                addBubble("bot", result.reply);
                history.push({ role: "assistant", content: result.reply });
                setQuick(result.suggestions || DEFAULT_SUGGESTIONS);
                setBusy(false);
                if (input) input.focus({ preventScroll: true });
            });
    }

    /* ---------- 입력창 ---------- */
    function autoGrow() {
        if (!input) return;
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 96) + "px";
    }

    /* ---------- 이벤트 ---------- */
    if (toggleBtn) toggleBtn.addEventListener("click", togglePanel);
    if (closeBtn) closeBtn.addEventListener("click", closePanel);

    if (form) {
        form.addEventListener("submit", function (e) {
            e.preventDefault();
            ask(input ? input.value : "");
        });
    }

    if (input) {
        input.addEventListener("input", autoGrow);
        input.addEventListener("keydown", function (e) {
            // Enter = 전송, Shift+Enter = 줄바꿈
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                if (form) form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
            }
        });
    }

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && container.classList.contains("ai-chat-open")) {
            closePanel();
        }
    });

    // 처음 상태: 패널 닫힘 + 기본 빠른 질문
    if (panel) panel.hidden = true;
    setQuick(DEFAULT_SUGGESTIONS);

    // 페이지가 설치된 모습을 알 수 있도록 표시(다른 스크립트/테스트에서 확인용)
    container.setAttribute("data-ai-chat", "ready");
})();
