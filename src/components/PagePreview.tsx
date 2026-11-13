import { useEffect, useRef, useState } from 'react';
import { renderPage } from '../preview';
import type { DeskPage, SourcePdf } from '../core/model';
import { Icon } from './Icon';

export function PagePreview({ source, page, large = false }: { source: SourcePdf; page: DeskPage; large?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(large);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (large) return;
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { rootMargin: '200px' });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, [large]);

  useEffect(() => {
    const target = canvas.current;
    if (!visible || !target) return;
    const controller = new AbortController();
    setStatus('loading');
    void renderPage(source, page, target, large, controller.signal).then(() => {
      if (!controller.signal.aborted) setStatus('ready');
    }).catch(() => {
      if (!controller.signal.aborted) setStatus('error');
    });
    return () => controller.abort();
  }, [source, page.sourcePage, page.rotation, large, visible]);

  return <div ref={container} className={`page-preview ${large ? 'page-preview-large' : ''}`}>
    {visible ? <canvas ref={canvas} aria-hidden="true" className={status === 'ready' ? '' : 'canvas-hidden'}/> : null}
    {(!visible || status === 'loading') ? <span className="preview-loading"><Icon name="file" size={25}/><small>پیش‌نمایش صفحه</small></span> : null}
    {visible && status === 'error' ? <span className="preview-error"><Icon name="file" size={25}/><small>پیش‌نمایش در دسترس نیست</small><small>خروجی را جداگانه بررسی کنید</small></span> : null}
  </div>;
}
