import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { zipSync } from 'fflate';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Icon, type IconName } from './components/Icon';
import { Modal } from './components/Modal';
import { PagePreview } from './components/PagePreview';
import { releasePreviews } from './preview';
import { createOutputs, inspectPdf } from './core/pdf';
import { DEFAULT_NUMBERS, DeskError, LIMITS, formatBytes, formatNumber as fa, parseRange, parseSplitGroups, rotateBy, safeFilename, type DeskPage, type Mode, type NumberSettings, type SourcePdf } from './core/model';
import { download, releaseDownloads } from './download';

const TOOLS: { id: Mode; label: string; icon: IconName; description: string }[] = [
  { id: 'merge', label: 'چیدمان و ادغام', icon: 'merge', description: 'فایل‌ها را کنار هم بگذارید؛ ترتیب صفحات، ترتیب PDF نهایی است.' },
  { id: 'split', label: 'تفکیک صفحات', icon: 'split', description: 'صفحات انتخاب‌شده را تکی یا در چند گروه، داخل یک فایل ZIP دریافت کنید.' },
  { id: 'rotate', label: 'چرخش صفحات', icon: 'rotate', description: 'جهت هر صفحه را اصلاح کنید؛ چرخش با کیفیت اصلی PDF ذخیره می‌شود.' },
  { id: 'number', label: 'شماره‌گذاری', icon: 'number', description: 'شمارهٔ فارسی یا لاتین را به صفحات انتخاب‌شده اضافه کنید.' },
];
const POSITIONS = [
  ['bottom-right', 'پایین راست'], ['bottom-center', 'پایین وسط'], ['bottom-left', 'پایین چپ'],
  ['top-right', 'بالا راست'], ['top-center', 'بالا وسط'], ['top-left', 'بالا چپ'],
] as const;
interface Output { name: string; bytes: Uint8Array }

function initialTheme(): 'light' | 'dark' {
  try { return localStorage.getItem('noxaplus-pdf-desk-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

export default function App() {
  const [sources, setSources] = useState<SourcePdf[]>([]);
  const [pages, setPages] = useState<DeskPage[]>([]);
  const [mode, setMode] = useState<Mode>('merge');
  const [numbers, setNumbers] = useState<NumberSettings>({ ...DEFAULT_NUMBERS });
  const [splitType, setSplitType] = useState<'each' | 'groups'>('each');
  const [splitRange, setSplitRange] = useState('1-2;3-4');
  const [range, setRange] = useState('');
  const [title, setTitle] = useState('NoxaPlus-PDF');
  const [theme, setTheme] = useState(initialTheme);
  const [help, setHelp] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [largePage, setLargePage] = useState<DeskPage | null>(null);
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [showOutputs, setShowOutputs] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'import' | 'export' | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const zipBytes = useRef<Uint8Array | null>(null);
  const included = pages.filter(page => page.included);
  const totalBytes = sources.reduce((total, source) => total + source.bytes.byteLength, 0);
  const tool = TOOLS.find(item => item.id === mode)!;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#132b25' : '#176d5b');
    try { localStorage.setItem('noxaplus-pdf-desk-theme', theme); } catch { /* Theme persistence is optional; PDF data is never stored. */ }
  }, [theme]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    releasePreviews(sources.map(source => source.id));
  }, [sources]);

  useEffect(() => {
    const protectDrop = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', protectDrop);
    window.addEventListener('drop', protectDrop);
    return () => {
      window.removeEventListener('dragover', protectDrop);
      window.removeEventListener('drop', protectDrop);
      abortRef.current?.abort();
      releasePreviews([]);
    };
  }, []);

  useEffect(() => {
    zipBytes.current = null;
    return releaseDownloads;
  }, [outputs]);

  const invalidateOutputs = () => { setOutputs([]); setMessage(''); setShowOutputs(false); };
  const changePages = (next: DeskPage[]) => { setPages(next); setDirty(next.length > 0); invalidateOutputs(); };
  const changeNumbers = (patch: Partial<NumberSettings>) => { setNumbers(previous => ({ ...previous, ...patch })); if (pages.length) setDirty(true); invalidateOutputs(); };
  const notify = (text: string) => { setMessage(text); setError(''); };
  const report = (cause: unknown) => { setError(cause instanceof DeskError ? cause.message : 'پردازش انجام نشد. فایل دیگری را امتحان کنید یا حجم و تعداد صفحات را کاهش دهید.'); setMessage(''); };

  async function importFiles(files: File[]) {
    if (busyRef.current || files.length === 0) return;
    busyRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy('import'); setError(''); setMessage(''); setProgress({ done: 0, total: files.length });
    try {
      if (sources.length + files.length > LIMITS.files) throw new DeskError(`حداکثر ${fa(LIMITS.files)} فایل می‌توانید روی میز قرار دهید.`);
      if (files.some(file => file.size > LIMITS.fileBytes)) throw new DeskError(`هر فایل باید حداکثر ${formatBytes(LIMITS.fileBytes)} باشد.`);
      if (totalBytes + files.reduce((sum, file) => sum + file.size, 0) > LIMITS.totalBytes) throw new DeskError(`حجم مجموع فایل‌ها نباید از ${formatBytes(LIMITS.totalBytes)} بیشتر شود.`);
      const incoming: SourcePdf[] = [];
      const newPages: DeskPage[] = [];
      for (const file of files) {
        controller.signal.throwIfAborted();
        const bytes = new Uint8Array(await file.arrayBuffer());
        controller.signal.throwIfAborted();
        const { pageCount } = await inspectPdf(bytes, file.name);
        controller.signal.throwIfAborted();
        if (pages.length + newPages.length + pageCount > LIMITS.pages) throw new DeskError(`میز کار حداکثر ${fa(LIMITS.pages)} صفحه می‌پذیرد. برای فایل‌های بزرگ‌تر در چند نوبت کار کنید.`);
        const source: SourcePdf = { id: crypto.randomUUID(), name: file.name, bytes, pageCount };
        incoming.push(source);
        for (let index = 0; index < pageCount; index++) newPages.push({ id: crypto.randomUUID(), sourceId: source.id, sourcePage: index, rotation: 0, included: true });
        setProgress({ done: incoming.length, total: files.length });
        await new Promise(resolve => window.setTimeout(resolve, 0));
      }
      controller.signal.throwIfAborted();
      setSources([...sources, ...incoming]);
      changePages([...pages, ...newPages]);
      notify(`${fa(incoming.length)} فایل و ${fa(newPages.length)} صفحه به میز اضافه شد.`);
    } catch (cause) {
      if (controller.signal.aborted) notify('ورود فایل لغو شد؛ میز قبلی بدون تغییر باقی ماند.');
      else report(cause instanceof DeskError ? new DeskError(`${cause.message} این دسته از فایل‌ها وارد نشد؛ میز قبلی تغییری نکرد.`) : cause);
    } finally {
      busyRef.current = false; abortRef.current = null; setBusy(null);
    }
  }

  async function loadDemo() {
    if (busyRef.current) return;
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const headings = ['A private desk for your PDFs.', 'Keep the pages that matter.', 'Find the right direction.', 'Every page in its place.'];
    for (const [index, heading] of headings.entries()) {
      const page = pdf.addPage([420, 594]);
      page.drawRectangle({ x: 0, y: 0, width: 420, height: 594, color: rgb(0.97, 0.96, 0.93) });
      page.drawRectangle({ x: 28, y: 390, width: 364, height: 165, color: rgb(0.09, 0.43, 0.36) });
      page.drawText(`0${index + 1}`, { x: 52, y: 442, size: 72, font, color: rgb(1, 1, 1) });
      page.drawText(heading, { x: 28, y: 332, size: 19, font, color: rgb(0.12, 0.2, 0.18) });
      page.drawText('NoxaPlus PDF Desk', { x: 28, y: 286, size: 12, font });
      page.drawText('This sample was generated locally in your browser.', { x: 28, y: 252, size: 11, font });
      page.drawText('No uploads. No account. Original files stay untouched.', { x: 28, y: 230, size: 11, font });
      for (let row = 0; row < 4; row++) page.drawRectangle({ x: 28, y: 165 - row * 20, width: row % 2 ? 210 : 300, height: 5, color: rgb(0.78, 0.81, 0.78) });
      page.drawText('www.noxaplus.ir', { x: 28, y: 35, size: 10, font });
    }
    const bytes = await pdf.save();
    await importFiles([new File([bytes.slice().buffer], 'NoxaPlus-demo.pdf', { type: 'application/pdf' })]);
  }

  function selectRange() {
    try {
      const indices = new Set(parseRange(range, pages.length));
      changePages(pages.map((page, index) => ({ ...page, included: indices.has(index) })));
      notify(`${fa(indices.size)} صفحه برای خروجی انتخاب شد.`);
    } catch (cause) { report(cause); }
  }

  function movePage(index: number, delta: number) {
    const next = [...pages];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    changePages(next);
  }

  async function exportPdf() {
    if (busyRef.current) return;
    const controller = new AbortController();
    try {
      if (!included.length) throw new DeskError('حداقل یک صفحه را برای خروجی انتخاب کنید.');
      let groups: number[][] | undefined;
      if (mode === 'split') {
        if (splitType === 'each') {
          if (included.length > LIMITS.splitFiles) throw new DeskError(`تفکیک تکی حداکثر ${fa(LIMITS.splitFiles)} صفحه را می‌پذیرد؛ تعداد صفحات انتخاب‌شده را کاهش دهید.`);
          groups = included.map((_, index) => [index]);
        } else groups = parseSplitGroups(splitRange, included.length);
      }
      busyRef.current = true; abortRef.current = controller;
      setBusy('export'); setError(''); setMessage(''); setProgress({ done: 0, total: included.length });
      const result = await createOutputs(sources, pages, { title: title.trim() || 'NoxaPlus-PDF', groups, numbers: mode === 'number' ? numbers : undefined, signal: controller.signal, onProgress: (done, total) => setProgress({ done, total }) });
      controller.signal.throwIfAborted();
      setOutputs(result); setShowOutputs(true);
      notify(`${fa(result.length)} فایل آماده است. برای ذخیره روی دستگاه، دکمهٔ دانلود را بزنید.`);
    } catch (cause) {
      if (controller.signal.aborted) notify('ساخت خروجی لغو شد؛ صفحات و فایل‌های اصلی تغییری نکردند.');
      else report(cause);
    } finally { busyRef.current = false; abortRef.current = null; setBusy(null); }
  }

  function downloadAll() {
    if (outputs.length === 1) {
      download(outputs[0].bytes, outputs[0].name, 'application/pdf');
    } else {
      if (!zipBytes.current) {
        const files: Record<string, Uint8Array> = Object.create(null);
        for (const output of outputs) files[output.name] = output.bytes;
        zipBytes.current = zipSync(files, { level: 0 });
      }
      download(zipBytes.current, safeFilename(title, 'zip'), 'application/zip');
    }
    setDirty(false);
    notify('دانلود به مرورگر سپرده شد. فایل‌ها را در پوشهٔ دانلود بررسی کنید.');
  }

  const numberInput = (key: 'start' | 'size' | 'margin', event: ChangeEvent<HTMLInputElement>) => changeNumbers({ [key]: event.target.value === '' ? NaN : Number(event.target.value) });
  const largeSource = largePage ? sources.find(source => source.id === largePage.sourceId) : undefined;
  const selectTool = (next: Mode) => { setMode(next); invalidateOutputs(); if (pages.length) setDirty(true); setError(''); };

  return (
    <div className="app">
      <a className="skip-link" href="#desk">رفتن به میز کار</a>
      <header className="topbar">
        <a className="brand" href="https://www.noxaplus.ir" target="_blank" rel="noopener noreferrer" aria-label="وب‌سایت NoxaPlus">
          <span className="brand-mark"><Icon name="file" size={25}/></span>
          <span className="brand-word" dir="ltr"><strong>NoxaPlus <span>PDF Desk</span></strong><small>YOUR FILES. YOUR DESK.</small></span>
        </a>
        <span className="topbar-note"><span className="status-dot"/> پردازش محلی، بدون آپلود <span className="version" dir="ltr">v1.0</span></span>
        <div className="header-actions">
          <button className="icon-btn" type="button" onClick={() => setHelp(true)} aria-label="راهنمای استفاده"><Icon name="help"/></button>
          <button className="icon-btn" type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? 'حالت تیره' : 'حالت روشن'}><Icon name={theme === 'light' ? 'moon' : 'sun'}/></button>
          <button className="btn btn-primary header-add" type="button" disabled={!!busy} onClick={() => fileInput.current?.click()}><Icon name="add" size={17}/> افزودن PDF</button>
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy"><p className="eyebrow" dir="ltr">NOXAPLUS / PRIVATE DOCUMENT TOOLS</p><h1>PDFها را مرتب کنید.<br/><em>نه حریم خصوصی را جابه‌جا.</em></h1><p className="hero-description">چند فایل، یک میز کار. ادغام، تفکیک، چرخش و شماره‌گذاری<br className="desktop-break"/> بدون فرستادن حتی یک صفحه به اینترنت.</p><div className="hero-tags"><span><Icon name="shield" size={15}/> بدون آپلود</span><span>بدون حساب کاربری</span><span>رایگان و متن‌باز</span></div></div>
          <div className="paper-art" aria-hidden="true"><span className="paper-art-label" dir="ltr">LOCAL FIRST.</span><div className="art-paper art-paper-back"><span>PDF</span></div><div className="art-paper art-paper-front"><div className="art-paper-top"><span>NoxaPlus</span><Icon name="file" size={19}/></div><strong>01<span> / 04</span></strong><i/><i/><i/><div className="art-paper-seal"><Icon name="check" size={17}/></div><small>میز کار خصوصی شما</small></div><span className="art-caption">اصل فایل، همیشه دست‌نخورده.</span></div>
        </section>

        <section className="desk" id="desk" aria-label="میز کار PDF">
          <div className="desk-title"><div><span className="section-index" dir="ltr">01 / WORKSPACE</span><h2>میز کار شما</h2></div><span className="desk-memory"><Icon name="shield" size={15}/> فایل‌ها فقط در حافظهٔ این تب هستند</span></div>
          <div className="tool-tabs" role="tablist" aria-label="ابزارهای PDF">{TOOLS.map(item => <button key={item.id} id={`tab-${item.id}`} type="button" role="tab" aria-selected={mode === item.id} aria-controls="tool-panel" tabIndex={mode === item.id ? 0 : -1} disabled={!!busy} className={mode === item.id ? 'is-active' : ''} onClick={() => selectTool(item.id)} onKeyDown={event => {
            const delta = event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0;
            if (!delta && !['Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const index = event.key === 'Home' ? 0 : event.key === 'End' ? TOOLS.length - 1 : (TOOLS.findIndex(t => t.id === item.id) + delta + TOOLS.length) % TOOLS.length;
            selectTool(TOOLS[index].id); document.getElementById(`tab-${TOOLS[index].id}`)?.focus();
          }}><Icon name={item.icon} size={19}/>{item.label}<span dir="ltr">0{TOOLS.indexOf(item) + 1}</span></button>)}</div>

          <input className="sr-only" ref={fileInput} type="file" accept=".pdf,application/pdf" multiple tabIndex={-1} aria-label="انتخاب فایل‌های PDF" disabled={!!busy} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void importFiles(files); }}/>
          <div className={`desk-layout ${dragging ? 'is-dragging' : ''}`} onDragEnter={event => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true); }} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }} onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void importFiles(Array.from(event.dataTransfer.files)); }}>
            {dragging ? <div className="drop-overlay"><Icon name="upload" size={35}/><strong>فایل‌های PDF را اینجا رها کنید</strong></div> : null}
            <aside className="settings" id="tool-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
              <div className="settings-heading"><span className="tool-symbol"><Icon name={tool.icon} size={24}/></span><h3>{tool.label}</h3></div><p className="settings-description">{tool.description}</p>
              <fieldset disabled={!!busy}>
                {mode === 'split' ? <div className="tool-options"><span className="field-label">روش تفکیک</span><label className="radio-option"><input type="radio" name="split-type" checked={splitType === 'each'} onChange={() => { setSplitType('each'); setDirty(pages.length > 0); invalidateOutputs(); }}/> هر صفحه، یک PDF</label><label className="radio-option"><input type="radio" name="split-type" checked={splitType === 'groups'} onChange={() => { setSplitType('groups'); setDirty(pages.length > 0); invalidateOutputs(); }}/> گروه‌های دلخواه</label>{splitType === 'groups' ? <><label htmlFor="split-range" className="field-label">گروه‌ها؛ با نقطه‌ویرگول جدا کنید</label><textarea id="split-range" dir="ltr" value={splitRange} maxLength={4000} onChange={event => { setSplitRange(event.target.value); setDirty(pages.length > 0); invalidateOutputs(); }}/><p className="field-hint">مثال: <bdi>1-2;3-4;5</bdi><br/>شماره‌ها بر اساس ترتیب صفحات حاضر در خروجی‌اند. گروه‌ها نباید هم‌پوشانی داشته باشند؛ صفحات خارج از گروه‌ها صادر نمی‌شوند.</p></> : <p className="field-hint">همهٔ PDFهای تفکیک‌شده در یک ZIP دانلود می‌شوند؛ سقف هر نوبت {fa(LIMITS.splitFiles)} فایل است.</p>}</div> : null}
                {mode === 'rotate' ? <div className="tool-options"><span className="field-label">چرخش همهٔ صفحات حاضر در خروجی</span><div className="rotate-actions"><button className="btn" type="button" disabled={!included.length} onClick={() => changePages(pages.map(page => page.included ? { ...page, rotation: rotateBy(page.rotation, 90) } : page))}><Icon name="rotate" size={17}/> ۹۰° راست</button><button className="btn" type="button" disabled={!included.length} onClick={() => changePages(pages.map(page => page.included ? { ...page, rotation: rotateBy(page.rotation, -90) } : page))}><Icon name="rotate" size={17} style={{ transform: 'scaleX(-1)' }}/> ۹۰° چپ</button></div><button className="text-btn" type="button" disabled={!pages.some(page => page.rotation)} onClick={() => changePages(pages.map(page => ({ ...page, rotation: 0 })))}>بازگردانی چرخش‌های این میز</button><p className="field-hint">چرخش اصلی فایل حفظ می‌شود. دکمهٔ روی هر صفحه برای چرخش مستقل آن است.</p></div> : null}
                {mode === 'number' ? <div className="tool-options number-options"><label className="field-label" htmlFor="number-position">جای شماره</label><select id="number-position" value={numbers.position} onChange={event => changeNumbers({ position: event.target.value as NumberSettings['position'] })}>{POSITIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div className="form-pair"><div><label className="field-label" htmlFor="number-start">شروع از</label><input id="number-start" type="number" min="1" max="999999" step="1" dir="ltr" value={Number.isNaN(numbers.start) ? '' : numbers.start} onChange={event => numberInput('start', event)}/></div><div><label className="field-label" htmlFor="number-size">اندازه (pt)</label><input id="number-size" type="number" min="8" max="36" step="1" dir="ltr" value={Number.isNaN(numbers.size) ? '' : numbers.size} onChange={event => numberInput('size', event)}/></div></div><label className="field-label" htmlFor="number-margin">فاصله از لبهٔ صفحه (pt)</label><input id="number-margin" type="number" min="8" max="72" step="1" dir="ltr" value={Number.isNaN(numbers.margin) ? '' : numbers.margin} onChange={event => numberInput('margin', event)}/><div className="form-pair"><div><label className="field-label" htmlFor="number-digits">رقم‌ها</label><select id="number-digits" value={numbers.digits} onChange={event => changeNumbers({ digits: event.target.value as NumberSettings['digits'] })}><option value="persian">فارسی</option><option value="latin">لاتین</option></select></div><div><label className="field-label" htmlFor="number-style">قالب</label><select id="number-style" value={numbers.style} onChange={event => changeNumbers({ style: event.target.value as NumberSettings['style'] })}><option value="plain">شماره</option><option value="fraction">شماره / تعداد</option></select></div></div><label className="checkbox-option"><input type="checkbox" checked={numbers.skipFirst} onChange={event => changeNumbers({ skipFirst: event.target.checked })}/> صفحهٔ اول (جلد) بدون شماره</label><p className="field-hint">شماره روی محتوای PDF افزوده می‌شود، نه جایگزین شمارهٔ قدیمی. پیش‌نمایش کارت‌ها اصل صفحه را نشان می‌دهد؛ شمارهٔ نهایی را پس از ساخت خروجی بررسی کنید.</p></div> : null}
                {mode === 'merge' ? <div className="merge-note"><span dir="ltr">PDF + PDF = ONE.</span><p>صفحات را با فلش‌های زیر هر کارت جابه‌جا کنید. با برداشتن تیک، صفحه را از خروجی کنار بگذارید.</p><p>فایل اصلی هرگز تغییر نمی‌کند.</p></div> : null}
                <div className="output-name"><label className="field-label" htmlFor="output-title">نام خروجی</label><div><input id="output-title" maxLength={100} value={title} onChange={event => { setTitle(event.target.value); if (pages.length) setDirty(true); invalidateOutputs(); }}/><span dir="ltr">.{mode === 'split' ? 'zip' : 'pdf'}</span></div></div>
                <button className="btn btn-primary export-button" type="button" disabled={!included.length} onClick={() => void exportPdf()}><Icon name="download" size={19}/>{mode === 'split' ? 'ساخت PDFهای تفکیک‌شده' : mode === 'number' ? 'ساخت PDF شماره‌دار' : 'ساخت PDF نهایی'}<Icon name="arrow" size={17}/></button>
              </fieldset>
              <div className="output-summary"><span>صفحات حاضر در خروجی</span><strong>{fa(included.length)}<small> / {fa(pages.length)}</small></strong></div>
              <p className="privacy-note"><Icon name="shield" size={16}/><span>هیچ فایلی آپلود یا در مرورگر ذخیره نمی‌شود. پیش از بستن تب، خروجی را دانلود کنید.</span></p>
            </aside>

            <div className="pages-panel">
              <div className="pages-toolbar"><div><Icon name="grid" size={18}/><h3>صفحات</h3><span className="count-badge">{fa(pages.length)}</span></div><div><button type="button" className="text-btn" disabled={!!busy || !pages.length} onClick={() => setConfirmClear(true)}><Icon name="trash" size={15}/> خالی‌کردن میز</button><button type="button" className="btn btn-small" disabled={!!busy} onClick={() => fileInput.current?.click()}><Icon name="add" size={16}/> افزودن فایل</button></div></div>
              {!pages.length ? <div className="empty-desk"><div className="empty-icon"><Icon name="upload" size={34}/></div><h3>اولین PDF را روی میز بگذارید</h3><p>فایل را اینجا بکشید، یا از دستگاه انتخاب کنید.<br/>همهٔ کارها همین‌جا، داخل مرورگر انجام می‌شود.</p><button type="button" className="btn btn-primary" disabled={!!busy} onClick={() => fileInput.current?.click()}><Icon name="add" size={18}/> انتخاب فایل‌های PDF</button><button type="button" className="text-btn demo-button" disabled={!!busy} onClick={() => void loadDemo()}>یا با یک PDF نمونه امتحان کنید <Icon name="arrow" size={15}/></button><div className="empty-limits"><span>هر فایل تا {formatBytes(LIMITS.fileBytes)}</span><span>تا {fa(LIMITS.pages)} صفحه</span><span>فقط PDF بدون رمز</span></div></div> : <>
                <div className="source-list" aria-label="فایل‌های واردشده">{sources.map(source => <div className="source-chip" key={source.id}><Icon name="file" size={16}/><div><bdi title={source.name}>{source.name}</bdi><small>{fa(source.pageCount)} صفحه · {formatBytes(source.bytes.byteLength)}</small></div><button className="icon-btn" type="button" disabled={!!busy} aria-label={`حذف فایل ${source.name} از میز`} onClick={() => { setSources(sources.filter(item => item.id !== source.id)); changePages(pages.filter(page => page.sourceId !== source.id)); }}><Icon name="close" size={15}/></button></div>)}</div>
                <fieldset className="selection-bar" disabled={!!busy}><div className="selection-all"><button type="button" className="text-btn" onClick={() => changePages(pages.map(page => ({ ...page, included: true })))}>انتخاب همه</button><span> / </span><button type="button" className="text-btn" onClick={() => changePages(pages.map(page => ({ ...page, included: false })))}>هیچ‌کدام</button></div><div className="range-selection"><label htmlFor="page-range">انتخاب بازه</label><input id="page-range" value={range} placeholder="1-3,5" maxLength={2000} dir="ltr" onChange={event => setRange(event.target.value)}/><button type="button" className="btn btn-small" onClick={selectRange}>اعمال</button></div></fieldset>
                <p className="page-instruction">شمارهٔ بالای کارت، جای صفحه روی میز است؛ تیک یعنی حضور در خروجی.</p>
                <div className="page-grid">{pages.map((page, index) => {
                  const source = sources.find(item => item.id === page.sourceId)!;
                  return <article className={`page-card ${page.included ? '' : 'is-excluded'}`} key={page.id} aria-label={`صفحهٔ میز ${fa(index + 1)}`}><div className="page-card-top"><label><input type="checkbox" checked={page.included} disabled={!!busy} aria-label={`حضور صفحهٔ ${fa(index + 1)} در خروجی`} onChange={event => changePages(pages.map(item => item.id === page.id ? { ...item, included: event.target.checked } : item))}/><span>{fa(index + 1).padStart(2, '۰')}</span></label><span className="rotation-label" dir="ltr">{page.rotation ? `+${page.rotation}°` : 'PDF'}</span></div><button type="button" className="preview-button" disabled={!!busy} aria-label={`بزرگ‌نمایی صفحهٔ ${fa(index + 1)}`} onClick={() => setLargePage(page)}><PagePreview source={source} page={page}/><span className="preview-hover"><Icon name="eye" size={19}/></span></button><div className="page-card-source"><bdi title={source.name}>{source.name}</bdi><span>صفحهٔ اصلی {fa(page.sourcePage + 1)}</span></div><div className="page-card-actions"><button className="icon-btn" type="button" disabled={!!busy || index === 0} aria-label={`انتقال صفحهٔ ${fa(index + 1)} به قبل`} onClick={() => movePage(index, -1)}><Icon name="arrow" size={16} style={{ transform: 'rotate(180deg)' }}/></button><button className="icon-btn" type="button" disabled={!!busy} aria-label={`چرخش صفحهٔ ${fa(index + 1)} به راست`} onClick={() => changePages(pages.map(item => item.id === page.id ? { ...item, rotation: rotateBy(item.rotation, 90) } : item))}><Icon name="rotate" size={16}/></button><button className="icon-btn" type="button" disabled={!!busy || index === pages.length - 1} aria-label={`انتقال صفحهٔ ${fa(index + 1)} به بعد`} onClick={() => movePage(index, 1)}><Icon name="arrow" size={16}/></button></div></article>;
                })}</div>
                <div className="workspace-stats"><span>{fa(sources.length)} فایل · {formatBytes(totalBytes)} در حافظه</span><span><span className="status-dot"/> آمادهٔ پردازش محلی</span></div>
              </>}
            </div>
          </div>
          {busy ? <div className="busy-bar" role="status"><span className="spinner"/><div><strong>{busy === 'import' ? 'خواندن و بررسی فایل‌ها…' : 'در حال ساخت خروجی…'}</strong><p>{fa(progress.done)} از {fa(progress.total)} {busy === 'import' ? 'فایل' : 'صفحه'}</p></div><progress max={progress.total || 1} value={progress.done}/><button className="btn btn-small" type="button" onClick={() => abortRef.current?.abort()}>لغو</button></div> : null}
          {error ? <div className="feedback feedback-error" role="alert"><Icon name="info" size={19}/><p>{error}</p><button className="icon-btn" type="button" aria-label="بستن پیام خطا" onClick={() => setError('')}><Icon name="close" size={16}/></button></div> : null}
          {message || outputs.length > 0 ? <div className="feedback" role="status"><Icon name="check" size={19}/><p>{message}</p>{outputs.length > 0 && !showOutputs ? <button type="button" className="btn btn-small" onClick={() => setShowOutputs(true)}>دیدن خروجی‌ها</button> : null}<button className="icon-btn" type="button" aria-label="بستن پیام" onClick={() => setMessage('')}><Icon name="close" size={16}/></button></div> : null}
          <div className="document-warning"><Icon name="info" size={19}/><p><strong>برای فایل‌های معمولی، نه سندهای حساس به ساختار.</strong> خروجی یک PDF جدید است؛ فرم‌های تعاملی، نشانک‌ها، ضمیمه‌ها، ساختار دسترس‌پذیری و امضاهای دیجیتال ممکن است حفظ نشوند. فایل‌های رمزدار پشتیبانی نمی‌شوند. خروجی را پیش از استفادهٔ رسمی بررسی کنید.</p></div>
        </section>
        <section className="privacy-strip"><div className="privacy-strip-symbol"><Icon name="shield" size={27}/></div><div><span className="eyebrow" dir="ltr">PRIVATE BY DESIGN</span><h2>فایل شما، از دستگاه شما بیرون نمی‌رود.</h2><p>نه سروری برای پردازش، نه حساب کاربری، نه ذخیرهٔ پنهانی. PDFها با بستن این تب از میز پاک می‌شوند؛ نسخهٔ اصلی روی دستگاه باقی می‌ماند.</p></div><button className="text-btn" type="button" onClick={() => setHelp(true)}>راهنما و محدودیت‌ها <Icon name="arrow" size={17}/></button></section>
      </main>
      <footer className="footer"><span dir="ltr"><strong>NoxaPlus</strong> PDF Desk · Free & open source · MIT</span><span>ساخته‌شده برای آرامش در کار با سندها.</span><a href="https://www.noxaplus.ir" target="_blank" rel="noopener noreferrer" dir="ltr">www.noxaplus.ir <Icon name="arrow" size={14} style={{ transform: 'rotate(135deg)' }}/></a></footer>

      <Modal open={help} onClose={() => setHelp(false)} title="راهنمای میز کار" subtitle="NoxaPlus PDF Desk — خصوصی، محلی و رایگان" size="lg">
        <div className="help-grid"><section><span>۰۱</span><h3>فایل‌ها را وارد کنید</h3><p>با دکمهٔ افزودن یا کشیدن و رهاکردن، PDFها را وارد کنید. فایل جدید به انتهای میز اضافه می‌شود. اگر یکی از فایل‌های یک دسته نامعتبر باشد، هیچ‌کدام از آن دسته وارد نمی‌شوند.</p></section><section><span>۰۲</span><h3>صفحات را مرتب کنید</h3><p>فلش‌های هر کارت ترتیب را تغییر می‌دهند. تیک حضور صفحه در خروجی را تعیین می‌کند؛ صفحهٔ بدون تیک حذف نمی‌شود. بازهٔ انتخاب، شماره‌های فعلی روی میز را به کار می‌برد.</p></section><section><span>۰۳</span><h3>ابزار را انتخاب کنید</h3><p>ادغام یک PDF می‌سازد. تفکیک خروجی‌های تکی یا گروهی دارد. چرخش قبلی در فایل حفظ می‌شود. شماره‌گذاری از صفحهٔ اول خروجی یا بعد از جلد شروع می‌شود؛ شمارش بر اساس صفحات خروجی است.</p></section><section><span>۰۴</span><h3>خروجی را دانلود و بررسی کنید</h3><p>ساخت خروجی کافی نیست؛ آن را دانلود کنید. صفحهٔ خروجی لینک دانلود هر PDF و دانلود یکجا را دارد. شماره‌های افزوده‌شده در کارت‌های ورودی نمایش داده نمی‌شوند؛ PDF نهایی را باز کنید.</p></section></div>
        <div className="help-limits"><h3>محدودیت‌های صادقانه</h3><ul><li>هر فایل تا {formatBytes(LIMITS.fileBytes)}؛ مجموع تا {formatBytes(LIMITS.totalBytes)}؛ {fa(LIMITS.files)} فایل و {fa(LIMITS.pages)} صفحه روی میز.</li><li>هر نوبت تفکیک تا {fa(LIMITS.splitFiles)} فایل؛ حجم مجموع PDFهای خروجی تا ۲۰۰ مگابایت.</li><li>فقط PDF بدون رمز. بازکردن قفل، OCR، فشرده‌سازی و ویرایش متن وجود ندارد.</li><li>PDF خراب یا غیرمعمول ممکن است پردازش نشود یا پیش‌نمایش دقیقی نداشته باشد. شکست پیش‌نمایش به‌تنهایی به معنی نامعتبر بودن فایل نیست.</li><li>شماره‌گذاری روی محتوای موجود قرار می‌گیرد. فاصله از لبهٔ بخش قابل‌نمایش صفحه محاسبه می‌شود؛ صفحات خیلی کوچک ممکن است برای شماره جا نداشته باشند.</li><li>سندهای امضاشده، PDF/A، فرم‌ها، نشانک‌ها، ضمیمه‌ها و ساختارهای دسترس‌پذیری تضمین نمی‌شوند. خروجی را برای چاپ، آرشیو یا کاربرد حقوقی بررسی کنید.</li><li>لغو هنگام خواندن یا ساخت، بین مرحله‌های پردازش اعمال می‌شود؛ بعضی فایل‌ها ممکن است چند لحظه طول بکشند.</li></ul></div><div className="help-privacy"><Icon name="shield" size={21}/><p>PDF، نام فایل و چیدمان در فضای ذخیره‌سازی مرورگر نوشته نمی‌شوند. فقط انتخاب حالت روشن/تیره ذخیره می‌شود. روی وب، یک Service Worker فایل‌های خود برنامه را برای اجرای آفلاین کش می‌کند؛ PDF شما کش نمی‌شود. لینک‌های برند فقط در صورت کلیک شما باز می‌شوند.</p></div><p className="help-contact" dir="ltr">NoxaPlus · www.noxaplus.ir · NoxaPlus2025@gmail.com</p>
      </Modal>
      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} title="میز کار خالی شود؟" size="sm" footer={<div className="modal-actions"><button type="button" className="btn" onClick={() => setConfirmClear(false)}>انصراف</button><button type="button" className="btn btn-danger" onClick={() => { setSources([]); changePages([]); setRange(''); setShowOutputs(false); setConfirmClear(false); notify('میز خالی شد؛ فایل‌های اصلی روی دستگاه تغییری نکردند.'); }}>تأیید خالی‌کردن میز</button></div>}><p className="confirm-text">فایل‌ها، چیدمان و خروجی‌های ساخته‌شده از حافظهٔ این تب کنار گذاشته می‌شوند. اگر هنوز دانلود نکرده‌اید، ابتدا خروجی را ذخیره کنید. این کار فایل اصلی روی دستگاه را حذف نمی‌کند.</p></Modal>
      <Modal open={!!largePage && !!largeSource} onClose={() => setLargePage(null)} title="پیش‌نمایش صفحه" subtitle={largeSource && largePage ? `${largeSource.name} · صفحهٔ اصلی ${fa(largePage.sourcePage + 1)}` : ''} size="lg">{largeSource && largePage ? <><div className="large-preview"><PagePreview source={largeSource} page={largePage} large/></div><p className="field-hint">این پیش‌نمایش ورودی و چرخش آن است؛ شماره‌گذاری فقط در خروجی نهایی افزوده می‌شود.</p></> : null}</Modal>
      <Modal open={showOutputs && outputs.length > 0} onClose={() => setShowOutputs(false)} title="خروجی آماده است" subtitle={`${fa(outputs.length)} فایل PDF؛ اصل فایل‌ها بدون تغییر باقی مانده‌اند.`} feedback={message} size="lg" footer={<div className="modal-actions"><button type="button" className="btn" onClick={() => setShowOutputs(false)}>بازگشت به میز</button><button type="button" className="btn btn-primary" onClick={downloadAll}><Icon name="download" size={18}/>{outputs.length === 1 ? 'دانلود PDF' : 'دانلود همه در ZIP'}</button></div>}><div className="output-list">{outputs.map(output => <div className="output-row" key={output.name}><span className="output-file-icon"><Icon name="file" size={25}/></span><div><bdi>{output.name}</bdi><small>{formatBytes(output.bytes.byteLength)}</small></div><button type="button" className="btn btn-small" onClick={() => { download(output.bytes, output.name, 'application/pdf'); if (outputs.length === 1) setDirty(false); notify('دانلود PDF به مرورگر سپرده شد.'); }}><Icon name="download" size={16}/> دانلود</button></div>)}</div><p className="field-hint output-reminder">خروجی‌ها هنوز فقط در حافظه‌اند. دانلود را انجام دهید و PDF نهایی را در نمایشگر خود بررسی کنید.</p></Modal>
    </div>
  );
}
