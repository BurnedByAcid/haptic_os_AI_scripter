import { useEffect } from "react";

interface PageMeta {
  title?: string;
  description?: string;
  canonical?: string;
  noindex?: boolean;
  og?: {
    title?: string;
    description?: string;
    image?: string;
    type?: string;
  };
  twitter?: {
    title?: string;
    description?: string;
    image?: string;
  };
}

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
  return el;
}

function removeMeta(name: string, attr: "name" | "property" = "name") {
  const el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  el?.remove();
}

function setLink(rel: string, href: string) {
  let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
  return el;
}

function removeLink(rel: string) {
  const el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  el?.remove();
}

const defaultTitle = "HapticOS";
const defaultDescription =
  "The unified platform for haptic device control. Sync videos with scripts, run manual sessions, and manage your devices — all in one place.";
const defaultOgImage = "/og-image.png";

export function usePageMeta(meta: PageMeta) {
  useEffect(() => {
    const prevTitle = document.title;

    if (meta.title) {
      document.title = meta.title;
    }

    if (meta.description) {
      setMeta("description", meta.description);
    }

    if (meta.noindex) {
      setMeta("robots", "noindex,follow");
    }

    if (meta.canonical) {
      setLink("canonical", meta.canonical);
    }

    if (meta.og) {
      if (meta.og.title) setMeta("og:title", meta.og.title, "property");
      if (meta.og.description) setMeta("og:description", meta.og.description, "property");
      if (meta.og.image) setMeta("og:image", meta.og.image, "property");
      if (meta.og.type) setMeta("og:type", meta.og.type, "property");
    }

    if (meta.twitter) {
      if (meta.twitter.title) setMeta("twitter:title", meta.twitter.title);
      if (meta.twitter.description) setMeta("twitter:description", meta.twitter.description);
      if (meta.twitter.image) setMeta("twitter:image", meta.twitter.image);
    }

    return () => {
      document.title = prevTitle;

      if (meta.description) setMeta("description", defaultDescription);
      if (meta.noindex) removeMeta("robots");
      if (meta.canonical) removeLink("canonical");

      if (meta.og) {
        setMeta("og:title", defaultTitle, "property");
        setMeta("og:description", defaultDescription, "property");
        setMeta("og:image", defaultOgImage, "property");
        setMeta("og:type", "website", "property");
      }

      if (meta.twitter) {
        setMeta("twitter:title", defaultTitle);
        setMeta("twitter:description", defaultDescription);
        setMeta("twitter:image", defaultOgImage);
      }
    };
  }, []);
}
