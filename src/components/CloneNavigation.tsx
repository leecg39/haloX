"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import parse from "html-react-parser";
import type { DialogRequest, PublicMenu } from "@/types/clone";
import { CloseIcon, SearchIcon, SidebarIcon } from "@/components/icons";
import { fetchTable } from "@/lib/api/client";
import "./clone-navigation.css";

export interface ActiveWorkspaceInfo {
  id: string;
  name: string;
  plan: string;
  domain?: string;
}

export const ACTIVE_WORKSPACE_STORAGE_KEY = "halox-clone:active-workspace";
const EMPTY_WORKSPACE_INFO: ActiveWorkspaceInfo = { id: "", name: "워크스페이스 선택", plan: "" };

export const DEFAULT_WORKSPACE_INFO: ActiveWorkspaceInfo = {
  id: "11111111-1111-4000-8000-111111111111",
  name: "브리찌",
  plan: "Trial",
  domain: "brizzi.kr",
};

export function readActiveWorkspace(): ActiveWorkspaceInfo {
  if (typeof window === "undefined") return EMPTY_WORKSPACE_INFO;
  try {
    const raw = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    if (!raw) return EMPTY_WORKSPACE_INFO;
    const parsed = JSON.parse(raw) as Partial<ActiveWorkspaceInfo>;
    if (parsed && typeof parsed.name === "string" && parsed.name.trim()) {
      return {
        id: parsed.id || DEFAULT_WORKSPACE_INFO.id,
        name: parsed.name.trim(),
        plan: parsed.plan || "Trial",
        domain: parsed.domain || "",
      };
    }
  } catch {
    // Ignore storage read error
  }
  return EMPTY_WORKSPACE_INFO;
}

export function writeActiveWorkspace(ws: ActiveWorkspaceInfo): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, JSON.stringify(ws));
  } catch {
    // Ignore storage quota error
  }
  window.dispatchEvent(new CustomEvent("halox:workspace-changed", { detail: ws }));
}

export async function loadAllWorkspaces(): Promise<ActiveWorkspaceInfo[]> {
  const [workspaces, plans] = await Promise.all([
    fetchTable<{ id: string; name: string; default_brand_filter?: string }>("workspaces"),
    fetchTable<{ workspace_id: string; plan: string }>("workspace_plans"),
  ]);
  return workspaces.map(row => ({
    id: row.id, name: row.name,
    plan: plans.find(plan => plan.workspace_id === row.id)?.plan || "Trial",
    domain: row.default_brand_filter || "",
  }));
}

export function applyWorkspaceToSidebarDom(root: HTMLElement | null, ws: ActiveWorkspaceInfo): void {
  if (!root) return;
  const headerBtn = root.querySelector<HTMLElement>('[data-sidebar="header"] button[aria-haspopup="menu"]');
  if (!headerBtn) return;
  const spans = headerBtn.querySelectorAll<HTMLElement>("div.grid > span");
  if (spans[0]) spans[0].textContent = ws.name;
  if (spans[1]) spans[1].textContent = ws.plan || "Trial";
}

type Item = readonly [label: string, url: string];
type Menu = { kind: "menu" | "search" | "drawer"; title: string; items: readonly Item[]; left?: number; top?: number; public?: boolean; html?: string };
type Options = {
  rootRef: RefObject<HTMLDivElement | null>;
  route: string;
  navigate: (url: string) => void;
  openDialog: (request: DialogRequest) => void;
  notify?: (message: string) => void;
  menus?: PublicMenu[];
};

const APP_ITEMS: readonly Item[] = [
  ["대시보드", "/app"], ["키워드 현황", "/app/keywords"], ["키워드 분석", "/app/seo/insights"], ["프롬프트 현황", "/app/geo/prompts"], ["프롬프트 분석", "/app/geo/analysis"],
  ["전략맵", "/app/strategy-map"], ["사이트 진단", "/app/site-audit"], ["콘텐츠 제작소", "/app/factory"], ["콘텐츠 최적화", "/app/optimize"], ["콘텐츠 내보내기", "/app/exports"],
  ["모니터링 대시보드", "/app/monitoring"], ["주간 리포트", "/app/reports/weekly"], ["페르소나", "/app/personas"], ["자료실", "/app/knowledgehub"], ["Raw 데이터", "/app/raw-data"],
];
const SEARCH_ITEMS: readonly Item[] = [...APP_ITEMS, ["설정", "/app/settings"], ["AI 대화 개요", "/app/geo"], ["기회 분석", "/app/gap"], ["추천 프로그램", "/app/referral"], ["피드백", "/app/feedback"]];
const ACCOUNT_ITEMS: readonly Item[] = [["Pro로 업그레이드", "/app/settings?tab=billing"], ["설정", "/app/settings"], ["결제", "/app/settings?tab=billing"], ["알림", "/app/settings?tab=notifications"], ["추천 프로그램", "/app/referral"], ["피드백", "/app/feedback"], ["문서", "https://docs.haloxlabs.ai"], ["로그아웃", "/app/login"]];
const LANGUAGE_ITEMS: readonly Item[] = [["한국어", "/ko"], ["English", "/en"]];
const GROUPS: Record<number, string> = { 1: "분석", 5: "전략", 7: "실행", 10: "모니터링", 12: "기타" };
const PUBLIC_APP_ROUTE = /^\/app\/(login|signup|forgot-password|reset-password|find-email|auth\/callback|verify-phone|invite)(\/|\?|$)/;

function publicItems(locale: string, kind: string): Item[] {
  const en = locale === "en";
  const lists: Record<string, Item[]> = {
    products: [[en ? "All features" : "전체 기능", "features"], ["SEO", "features/search"], ["GEO", "features/monitoring"], [en ? "Site audit" : "사이트 진단", "features/audit"], [en ? "Content" : "콘텐츠 제작", "features/content"]],
    resources: [[en ? "Blog" : "블로그", "blog"], [en ? "Glossary" : "용어 사전", "glossary"], [en ? "Updates" : "업데이트", "changelog"], [en ? "Compare" : "서비스 비교", "methodology"]],
    contact: [[en ? "Consulting" : "SEO/GEO 컨설팅", "consulting"], [en ? "Contact" : "도입 문의", "contact-sales"]],
  };
  return (lists[kind] || []).map(([label, path]) => [label, `/${locale}/${path}`]);
}

export function useCloneNavigation({ rootRef, route, navigate, openDialog, notify, menus }: Options) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [query, setQuery] = useState("");
  const [activeWorkspace, setActiveWorkspace] = useState<ActiveWorkspaceInfo>(EMPTY_WORKSPACE_INFO);
  const [workspaces, setWorkspaces] = useState<ActiveWorkspaceInfo[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const collapsedRef = useRef(false);
  const locale = route.match(/^\/(ko|en|ja|zh|id|vi)(?:\/|$)/)?.[1] || "ko";
  const needsWorkspaces = route.startsWith("/app") && !PUBLIC_APP_ROUTE.test(route);

  const refreshWorkspaces = useCallback(async () => {
    const current = readActiveWorkspace();
    let list: ActiveWorkspaceInfo[];
    try { list = await loadAllWorkspaces(); } catch { return; }
    const matched = list.find(w => w.id === current.id) || list[0] || EMPTY_WORKSPACE_INFO;
    try { localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, JSON.stringify(matched)); } catch {}

    setActiveWorkspace(matched);
    setWorkspaces(list);
    applyWorkspaceToSidebarDom(rootRef.current, matched);
  }, [rootRef]);

  useEffect(() => {
    if (!needsWorkspaces) return;
    void refreshWorkspaces();
    const onWsChange = () => {
      void refreshWorkspaces();
    };
    window.addEventListener("halox:workspace-changed", onWsChange);
    window.addEventListener("halox:record-created", onWsChange);
    return () => {
      window.removeEventListener("halox:workspace-changed", onWsChange);
      window.removeEventListener("halox:record-created", onWsChange);
    };
  }, [refreshWorkspaces, needsWorkspaces]);

  const close = useCallback(() => {
    setMenu(null); setQuery("");
    triggerRef.current?.setAttribute("aria-expanded", "false");
    triggerRef.current?.setAttribute("data-state", "closed");
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    close();
    const sidebar = rootRef.current?.querySelector("[data-sidebar=sidebar]")?.closest("[data-collapsible]");
    sidebar?.setAttribute("data-collapsible", collapsedRef.current ? "icon" : "");
    sidebar?.setAttribute("data-state", collapsedRef.current ? "collapsed" : "expanded");
  }, [route, rootRef, close]);

  useEffect(() => {
    applyWorkspaceToSidebarDom(rootRef.current, activeWorkspace);
  }, [route, rootRef, activeWorkspace]);

  useEffect(() => {
    if (!menu) return;
    const previousOverflow = document.body.style.overflow;
    if (menu.kind !== "menu") document.body.style.overflow = "hidden";
    (overlayRef.current?.querySelector<HTMLElement>("input") || overlayRef.current?.querySelector<HTMLElement>("button,a"))?.focus();
    const pointer = (event: PointerEvent) => { if (!overlayRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close(); };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      const nodes = Array.from(overlayRef.current?.querySelectorAll<HTMLElement>("input,button,a[href]") || []);
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (menu.kind === "menu" && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault(); nodes[event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + nodes.length) % nodes.length]?.focus();
      } else if (event.key === "Tab" && (event.shiftKey ? index <= 0 : index === nodes.length - 1)) { event.preventDefault(); nodes[event.shiftKey ? nodes.length - 1 : 0]?.focus(); }
    };
    document.addEventListener("pointerdown", pointer); document.addEventListener("keydown", keyboard);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", keyboard); };
  }, [menu, close]);

  function show(button: HTMLElement, next: Menu) {
    if (triggerRef.current === button && menu?.title === next.title) { close(); return; }
    close(); triggerRef.current = button; button.setAttribute("aria-expanded", "true"); button.setAttribute("data-state", "open");
    if (next.public && next.kind === "drawer") { const mobile = menus?.find(m => m.label === "모바일 메인 메뉴"); if (mobile) next = { ...next, html: mobile.panelHtml }; }
    const original = menus?.find(m => m.label === next.title); if (original && next.kind === "menu" && original.links.some(l => l.href)) { next = { ...next, html: original.panelHtml, items: original.links.filter(l => l.href).map(l => [l.text, l.href!] as const) }; }
    const rect = button.getBoundingClientRect();
    setMenu({ ...next, left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), top: rect.bottom + 6 > window.innerHeight - 320 ? Math.max(8, rect.top - Math.min(320, next.items.length * 32 + 12)) : rect.bottom + 6 });
  }

  function buildWorkspaceMenuItems(list: ActiveWorkspaceInfo[], current: ActiveWorkspaceInfo): Item[] {
    const switchItems: Item[] = list.map(ws => [
      `${ws.id === current.id ? "✓ " : ""}${ws.name} (${ws.plan || "Trial"})`,
      `#switch-workspace:${encodeURIComponent(ws.id)}`,
    ]);
    return [
      ...switchItems,
      ["내 워크스페이스 관리", "/app/workspaces"],
      ["워크스페이스 설정", "/app/settings?tab=workspace"],
      ["+ 새 워크스페이스 만들기", "#new-workspace"],
    ];
  }

  function select(url: string) {
    close();
    if (url.startsWith("#switch-workspace:")) {
      const targetId = decodeURIComponent(url.slice("#switch-workspace:".length));
      const chosen = workspaces.find(w => w.id === targetId);
      if (!chosen) return;
      writeActiveWorkspace(chosen);
      setActiveWorkspace(chosen);
      applyWorkspaceToSidebarDom(rootRef.current, chosen);
      notify?.(`'${chosen.name}' 워크스페이스로 전환했습니다.`);
      return;
    }
    if (url === "#new-workspace") {
      navigate("/app/workspaces?create=1");
    } else if (url.startsWith("http")) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      navigate(url);
    }
  }

  function handleClick(event: MouseEvent): boolean {
    const button = (event.target as Element)?.closest<HTMLElement>("button,[role=button]");
    if (!button || !rootRef.current?.contains(button) || button.closest("[data-clone-navigation]")) return false;
    const text = (button.textContent || "").replace(/\s+/g, " ").trim(), label = button.getAttribute("aria-label") || "";
    let handled = true;
    if (button.matches('[data-sidebar="trigger"],[data-sidebar="rail"]') || label === "Toggle Sidebar") {
      if (window.innerWidth < 768) show(button, { kind: "drawer", title: "메뉴", items: APP_ITEMS });
      else { collapsedRef.current = !collapsedRef.current; const side = rootRef.current.querySelector("[data-sidebar=sidebar]")?.closest("[data-collapsible]"); side?.setAttribute("data-collapsible", collapsedRef.current ? "icon" : ""); side?.setAttribute("data-state", collapsedRef.current ? "collapsed" : "expanded"); }
    } else if (button.matches('[data-sidebar="group-label"]') && /^(분석|전략|실행|모니터링|기타)$/.test(text)) {
      const content = button.nextElementSibling as HTMLElement | null, expanded = button.getAttribute("aria-expanded") !== "false";
      button.setAttribute("aria-expanded", String(!expanded)); button.setAttribute("data-state", expanded ? "closed" : "open");
      button.closest(".group\\/collapsible")?.setAttribute("data-state", expanded ? "closed" : "open");
      if (content) { content.hidden = expanded; content.style.display = expanded ? "none" : ""; content.setAttribute("data-state", expanded ? "closed" : "open"); }
    } else if (button.closest('[data-sidebar="header"]') && button.getAttribute("aria-haspopup") === "menu") {
      const current = readActiveWorkspace();
      const matched = workspaces.find(w => w.id === current.id) || workspaces[0] || EMPTY_WORKSPACE_INFO;
      show(button, {
        kind: "menu",
        title: `${matched.name} · ${matched.plan || "Trial"}`,
        items: buildWorkspaceMenuItems(workspaces, matched),
      });
    }
    else if (button.closest("header") && button.getAttribute("aria-haspopup") === "menu" && (text.includes("@") || button.querySelector(".lucide-user"))) show(button, { kind: "menu", title: "내 계정", items: ACCOUNT_ITEMS });
    else if (/빠른 탐색/.test(text + label)) show(button, { kind: "search", title: "빠른 탐색", items: SEARCH_ITEMS });
    else if (/도움이 필요/.test(text)) { const content = button.nextElementSibling as HTMLElement | null; const open = button.getAttribute("aria-expanded") !== "false"; button.setAttribute("aria-expanded", String(!open)); if (content) { content.hidden = open; content.style.display = open ? "none" : ""; } }
    else if (/^SEO\/GEO 컨설팅/.test(text)) select("/ko/consulting");
    else if (/^서비스 개선 피드백/.test(text)) select("/app/feedback");
    else if (/^플랜\s*보기$/.test(text)) select("/app/settings?tab=billing");
    else if (button.closest("header") && /^(제품|Products?|리소스|Resources|도입 문의|Contact(?: sales)?)$/.test(text)) show(button, { kind: "menu", title: text, items: publicItems(locale, /제품|Products?/.test(text) ? "products" : /리소스|Resources/.test(text) ? "resources" : "contact") });
    else if (/언어 선택|Select language|Choose language/i.test(label)) show(button, { kind: "menu", title: "언어 / Language", items: LANGUAGE_ITEMS });
    else if (/메뉴 열기|Open menu|Toggle menu/i.test(label)) show(button, { kind: "drawer", title: locale === "en" ? "Menu" : "메뉴", public: true, items: [...publicItems(locale, "products"), ...publicItems(locale, "resources"), [locale === "en" ? "Customers" : "고객 사례", `/${locale}/customers`], [locale === "en" ? "Pricing" : "가격 안내", `/${locale}/pricing`], ...publicItems(locale, "contact")] });
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
    return handled;
  }

  const visibleItems = menu?.items.filter(([label, url]) => `${label} ${url}`.toLowerCase().includes(query.toLowerCase())) || [];
  const overlay = menu && <div className={`clone-nav-layer clone-nav-${menu.kind}${menu.public ? " clone-nav-public" : ""}`} data-clone-navigation="true" onClick={event => event.stopPropagation()}>
    {menu.kind !== "menu" && <div className="clone-nav-backdrop" onClick={close} />}
    <div ref={overlayRef} className={"clone-nav-panel" + (menu.html ? " clone-nav-rich" : "")} role={menu.kind === "menu" ? "menu" : "dialog"} aria-modal={menu.kind !== "menu" || undefined} aria-label={menu.title} style={menu.kind === "menu" ? { left: menu.left, top: menu.top } : undefined}>
      <div className="clone-nav-heading"><span>{menu.title}</span>{menu.kind !== "menu" && <button onClick={close} aria-label="닫기"><CloseIcon size={16} /></button>}</div>
      {menu.kind === "search" && <label className="clone-nav-searchbox"><SearchIcon size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="페이지 이름으로 검색..." aria-label="페이지 검색" onKeyDown={event => { if (event.key === "Enter" && visibleItems[0]) select(visibleItems[0][1]); }} /><kbd>ESC</kbd></label>}
      {menu.kind === "drawer" && !menu.public && <button className="clone-nav-workspace" onClick={() => select("/app/workspaces")}><SidebarIcon size={24} /><span>{activeWorkspace.name}<small>{activeWorkspace.plan || "Trial"}</small></span></button>}
      <div className="clone-nav-list">{menu.html ? <div onClick={event => { const target = event.target as HTMLElement; const btn = target.closest<HTMLButtonElement>("button[aria-expanded]"); if (btn && menu.public) { const original = menus?.find(m => m.label === "모바일 " + btn.textContent?.trim()); const panel = btn.nextElementSibling as HTMLElement | null; if (original && panel) { const open = btn.getAttribute("aria-expanded") !== "true"; btn.setAttribute("aria-expanded", String(open)); panel.hidden = !open; panel.style.display = open ? "block" : "none"; if (open) panel.innerHTML = original.panelHtml; return; } } const a = target.closest("a"); if (a && !event.metaKey && !event.ctrlKey) { event.preventDefault(); select(a.getAttribute("href") || "/ko"); } }}>{parse(menu.html)}</div> : visibleItems.map(([text, url], index) => <div key={`${text}:${url}`}>{menu.kind === "drawer" && !menu.public && GROUPS[index] && <p className="clone-nav-group">{GROUPS[index]}</p>}<a role={menu.kind === "menu" ? "menuitem" : undefined} href={url} aria-current={route.split("?")[0] === url || text.startsWith("✓ ") ? "page" : undefined} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) { event.preventDefault(); select(url); } }}><span>{text}</span>{menu.kind === "search" && <small>{url}</small>}</a></div>)}{!visibleItems.length && <p className="clone-nav-empty">검색 결과가 없습니다.</p>}</div>
      {menu.kind === "drawer" && !menu.html && <div className="clone-nav-footer"><button onClick={() => select(menu.public ? "/app" : "/app/settings")}>{menu.public ? "대시보드로 이동" : "설정"}</button><button onClick={() => select(menu.public ? `/${locale}/contact-sales` : "/app/feedback")}>{menu.public ? "문의하기" : "서비스 개선 피드백"}</button></div>}
    </div>
  </div>;
  return { handleClick, overlay };
}
