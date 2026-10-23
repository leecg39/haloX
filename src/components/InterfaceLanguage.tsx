'use client';
import { useEffect } from 'react';
import type { InterfaceLanguage } from '@/lib/api/general-settings';
import { translateUiText } from '@/lib/ui-language';

const ATTRIBUTES = ['aria-label', 'placeholder', 'title'] as const;
type OriginalText = { ko: string; en: string };
const originalTexts = new WeakMap<Text, OriginalText>();
const originalAttributes = new WeakMap<Element, Map<string, OriginalText>>();

/** Applies the account locale to captured and live admin DOM without changing user data records. */
export function InterfaceLanguageLayer({ language }: { language: InterfaceLanguage }) {
  useEffect(() => {
    document.documentElement.lang = language;
    let applying = false;
    const text = (node: Text) => {
      const current = node.data; let entry = originalTexts.get(node);
      if (!entry) { entry = { ko: current, en: translateUiText(current, 'en') }; originalTexts.set(node, entry); }
      else if (current !== entry.en && current !== entry.ko) { entry = { ko: current, en: translateUiText(current, 'en') }; originalTexts.set(node, entry); }
      const next = language === 'en' ? entry.en : entry.ko; if (current !== next) node.data = next;
    };
    const element = (node: Element) => {
      let values = originalAttributes.get(node); if (!values) { values = new Map(); originalAttributes.set(node, values); }
      for (const name of ATTRIBUTES) {
        const current = node.getAttribute(name); if (current === null) continue;
        let entry = values.get(name); if (!entry) { entry = { ko: current, en: translateUiText(current, 'en') }; values.set(name, entry); }
        else if (current !== entry.en && current !== entry.ko) { entry = { ko: current, en: translateUiText(current, 'en') }; values.set(name, entry); }
        const next = language === 'en' ? entry.en : entry.ko; if (current !== next) node.setAttribute(name, next);
      }
    };
    const apply = (root: Node) => {
      if (applying) return; applying = true;
      try {
        if (root.nodeType === Node.TEXT_NODE) text(root as Text);
        if (root instanceof Element) element(root);
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT); let node: Node | null;
        while ((node = walker.nextNode())) node.nodeType === Node.TEXT_NODE ? text(node as Text) : element(node as Element);
      } finally { applying = false; }
    };
    const surfaces = () => document.querySelectorAll('.clone-app').forEach(apply);
    surfaces();
    const observer = new MutationObserver(records => { if (applying) return; for (const record of records) { if (record.type === 'characterData') apply(record.target); else if (record.type === 'attributes') apply(record.target); else record.addedNodes.forEach(apply); } });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
    return () => { observer.disconnect(); document.documentElement.lang = 'ko'; };
  }, [language]);
  return null;
}
