import { useEffect, useRef } from 'react';
import { useExternalScript } from '../hooks/useExternalScript.js';
import { fixAssetPaths } from '../lib/assetPath.js';

// Renders raw HTML (verbatim from the original page) and runs an optional
// external script after mount. Asset paths inside the HTML/script are rewritten
// at runtime to honor Vite base (so GH Pages /daemu-website/ subpath works).
export default function RawPage({ html, bodyClass, script }) {
  const ref = useRef(null);
  useExternalScript(script || null, [script]);

  useEffect(() => {
    if (!bodyClass) return;
    const classes = bodyClass.split(/\s+/).filter(Boolean);
    classes.forEach((c) => document.body.classList.add(c));
    return () => classes.forEach((c) => document.body.classList.remove(c));
  }, [bodyClass]);

  return <div ref={ref} dangerouslySetInnerHTML={{ __html: fixAssetPaths(html) }} />;
}
