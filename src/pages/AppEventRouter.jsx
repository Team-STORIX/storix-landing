import { useEffect, useState } from "react";
import { getPublicAppEvent } from "../features/app-event/api.js";
import { ApiError } from "../lib/apiClient.js";
import {
  isStorixWebView,
  postStorixWebViewMessage,
} from "../lib/webViewBridge.js";
import AttendanceEventPage from "./AttendanceEventPage.jsx";
import StoryCardEventPage from "./StoryCardEventPage.jsx";
import "../event-router.css";

const PAGES = {
  attendance: AttendanceEventPage,
  "attendance-2026-08-10": AttendanceEventPage,
  "attendance-2026-08-17": AttendanceEventPage,
  "story-card": StoryCardEventPage,
  "story-card-2026-08-16": StoryCardEventPage,
};

const DEFAULT_BY_TYPE = {
  ATTENDANCE: AttendanceEventPage,
  STORY_CARD: StoryCardEventPage,
};

const STATIC_EVENTS = {
  7: {
    id: 7,
    name: "오늘의 스토리카드",
    description: "오늘의 스토리 카드 이벤트",
    eventType: "STORY_CARD",
    pageKey: "story-card",
    startAt: "",
    endAt: "",
    status: "ACTIVE",
  },
};

function closeEventPage() {
  if (isStorixWebView()) {
    postStorixWebViewMessage({ type: "CLOSE_WEBVIEW" });
    return;
  }

  if (window.history.length > 1) {
    window.history.back();
    return;
  }

  window.location.assign("/");
}

function EventStatePage({ title, description, actionLabel = "확인" }) {
  return (
    <main className="eventStatePage">
      <section className="eventStateCard" role="status">
        <div className="eventStateMark" aria-hidden="true">
          ✦
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
        <button type="button" onClick={closeEventPage}>
          {actionLabel}
        </button>
      </section>
    </main>
  );
}

function EventErrorToast() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setVisible(false), 2500);
    return () => window.clearTimeout(timeoutId);
  }, []);

  return (
    <main className="eventToastPage">
      {visible ? (
        <div className="eventErrorToast" role="status" aria-live="polite">
          잠시 후 다시 시도해주세요.
        </div>
      ) : null}
    </main>
  );
}

function EventEndedPage() {
  return (
    <main className="eventEndedPage">
      <div className="eventEndedBackdrop">
        <section
          className="eventEndedModal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-ended-title"
          aria-describedby="event-ended-description"
        >
          <div className="eventEndedContent">
            <img
              className="eventEndedIcon"
              src="/events/warning.png"
              alt=""
              aria-hidden="true"
            />
            <div className="eventEndedCopy">
              <h1 id="event-ended-title">마감된 이벤트입니다</h1>
              <p id="event-ended-description">다음 이벤트를 기대해주세요!</p>
            </div>
          </div>
          <button type="button" onClick={closeEventPage}>
            확인
          </button>
        </section>
      </div>
    </main>
  );
}

function EventFallbackPage() {
  return (
    <EventStatePage
      title="이벤트 페이지를 준비 중입니다"
      description="현재 버전에서 지원하지 않는 이벤트입니다. 잠시 후 다시 확인해주세요."
    />
  );
}

export default function AppEventRouter({ appEventId }) {
  const [state, setState] = useState({
    status: "loading",
    event: null,
    error: null,
  });

  useEffect(() => {
    const staticEvent = STATIC_EVENTS[appEventId];
    if (staticEvent) {
      setState({ status: "ready", event: staticEvent, error: null });
      return undefined;
    }

    const controller = new AbortController();
    setState({ status: "loading", event: null, error: null });

    getPublicAppEvent(appEventId, { signal: controller.signal })
      .then((event) => setState({ status: "ready", event, error: null }))
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setState({ status: "error", event: null, error });
      });

    return () => controller.abort();
  }, [appEventId]);

  if (state.status === "loading") {
    return (
      <main className="eventStatePage">
        <div
          className="eventLoading"
          role="status"
          aria-label="이벤트 불러오는 중"
        />
      </main>
    );
  }

  if (state.status === "error") {
    const isNotFound =
      state.error instanceof ApiError && state.error.status === 404;
    if (!isNotFound) return <EventErrorToast />;

    return (
      <EventStatePage
        title="이벤트를 찾을 수 없습니다"
        description="존재하지 않거나 아직 시작하지 않은 이벤트입니다."
      />
    );
  }

  const event = state.event;

  if (event.status === "ENDED" || event.status === "CANCELED") {
    return <EventEndedPage />;
  }

  if (event.status !== "ACTIVE") {
    return (
      <EventStatePage
        title="아직 시작하지 않은 이벤트입니다"
        description="이벤트 시작 후 다시 참여해주세요."
      />
    );
  }

  const Page =
    PAGES[event.pageKey] ??
    DEFAULT_BY_TYPE[event.eventType] ??
    EventFallbackPage;
  return <Page appEventId={appEventId} event={event} />;
}
