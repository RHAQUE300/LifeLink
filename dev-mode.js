/* LifeLink Developer Mode: additive, lazy-loaded, browser-native workspace. */
(function () {
  'use strict';
  const VERSION = '0.7.3', PREFIX = 'lifelink.dev.workspace.v1:', MAX_FILE = 250000, MAX_LOG = 350, SAVE_DELAY = 800, MAX_LOG_LINE = 12000;
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const svg = path => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  const I = {
    code:svg('<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/>'),
    close:svg('<path d="m18 6-12 12M6 6l12 12"/>'),
    play:svg('<path d="m7 4 13 8-13 8z"/>'),
    save:svg('<path d="M5 3h12l4 4v14H3V3h2zm2 0v6h10V3M7 21v-8h10v8"/>'),
    plus:svg('<path d="M12 5v14M5 12h14"/>'),
    folder:svg('<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    download:svg('<path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/>'),
    bot:svg('<rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4m-4 5h.01M16 12h.01M8 16h8"/>'),
    refresh:svg('<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/>'),
    trash:svg('<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 4v6m6-6v6"/>'),
    explorerHide:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 8l-3 4 3 4"/>'),
    assistantHide:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M9 8l3 4-3 4"/>'),
    explorerShow:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M12 8l3 4-3 4"/>'),
    assistantShow:svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18M12 8l-3 4 3 4"/>')
  };
  let root = null, editor = null, workspace = null, activeFile = 'index.html';
  let opened = false, outputMode = 'console', aiBusy = false, aiMessages = [], latestCodeBlocks = [], previewToken = '';
  let saveTimer = null, logFrame = 0, logQueue = [], lastErrorText = '', cursorTimer = null;

  function key() {
    const owner = typeof S !== 'undefined' && S && S.ownerEmail ? S.ownerEmail :
      (typeof currentEmail !== 'undefined' && currentEmail ? currentEmail : 'local');
    return PREFIX + String(owner).toLowerCase();
  }
  function starter() {
    return {name:'Untitled project',files:[
      {name:'index.html',content:'<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>My first project</title>\n</head>\n<body>\n  <main>\n    <h1>Hello, LifeLink!</h1>\n    <p>Your developer workspace is ready.</p>\n    <button id="hello">Click me</button>\n  </main>\n</body>\n</html>'},
      {name:'styles.css',content:'body {\n  margin: 0;\n  min-height: 100vh;\n  display: grid;\n  place-items: center;\n  font-family: system-ui, sans-serif;\n  background: #eef3fb;\n  color: #1d2433;\n}\nmain { text-align: center; padding: 2rem; }\nbutton { padding: .7rem 1rem; border: 0; border-radius: 999px; background: #4f7cff; color: white; cursor: pointer; }'},
      {name:'app.js',content:"document.querySelector('#hello')?.addEventListener('click', () => {\n  console.log('Hello from your sandboxed LifeLink preview!');\n});"}
    ]};
  }
  function load() {
    try {
      const value = JSON.parse(localStorage.getItem(key()) || 'null');
      if (value && Array.isArray(value.files)) {
        value.files = value.files.filter(f => f && typeof f.name === 'string' && typeof f.content === 'string')
          .map(f => ({name:f.name.slice(0,100),content:f.content.slice(0,MAX_FILE)}));
        if (value.files.length) return value;
      }
    } catch (e) { console.warn('LifeLink Dev workspace restore failed',e); }
    return starter();
  }
  function tell(message) {
    if (typeof window.toast === 'function') window.toast(message);
    else console.info('[LifeLink Dev] ' + message);
  }
  function status(message, state) {
    const el=$('#dev-status');
    if(!el)return;
    el.textContent=message;
    el.dataset.state=state || (message==='All changes saved'?'saved':'normal');
  }
  function save(showMessage) {
    if (!workspace) return false;
    if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
    try {
      localStorage.setItem(key(),JSON.stringify(workspace));
      status('All changes saved','saved');
      if (showMessage) tell('Developer workspace saved');
      return true;
    } catch (e) {
      status('Storage full','error');
      log('Could not save locally. Download files as a backup.','warn');
      if (showMessage) tell('Could not save: browser storage may be full');
      return false;
    }
  }
  function scheduleSave() {
    status('Unsaved changes','pending');
    if(saveTimer)clearTimeout(saveTimer);
    saveTimer=setTimeout(()=>{saveTimer=null;save(false);},SAVE_DELAY);
  }
  function flushSave(showMessage) { return save(!!showMessage); }
  function ext(name) { return String(name || '').split('.').pop().toLowerCase(); }
  function current() { return workspace && workspace.files.find(f=>f.name===activeFile); }
  function glyph(name) { return ({html:'◇',htm:'◇',css:'#',js:'JS',mjs:'JS',json:'{}',md:'M',py:'Py',sql:'DB'})[ext(name)] || '·'; }

  function buildUI() {
    if (root) return;
    root=document.createElement('section');
    root.id='dev-full'; root.setAttribute('role','dialog'); root.setAttribute('aria-modal','true'); root.setAttribute('aria-label','LifeLink Developer Mode');
    root.innerHTML =
      '<header id="dev-head"><div class="dev-brand"><span class="dev-brand-mark">'+I.code+'</span><span>LifeLink Dev</span></div>'+
      '<input id="dev-project-name" class="dev-project-name" aria-label="Project name" value="Untitled project" maxlength="60">'+
      '<span id="dev-status" class="dev-status" role="status">Ready</span>'+
      '<button class="dev-head-btn" id="dev-explorer-toggle" aria-label="Collapse Explorer" aria-expanded="true" title="Toggle Explorer">'+I.folder+'<span class="dev-btn-label">Files</span></button>'+
      '<button class="dev-head-btn" id="dev-ai-toggle" aria-label="Toggle AI assistant" aria-expanded="false" title="Toggle AI assistant">'+I.bot+'<span class="dev-btn-label">AI</span></button><span class="dev-head-spacer"></span>'+
      '<button class="dev-head-btn" id="dev-open-files" title="Import files">'+I.folder+'<span class="dev-btn-label">Import</span></button>'+
      '<button class="dev-head-btn" id="dev-download-file" title="Download active file">'+I.download+'<span class="dev-btn-label">Export</span></button>'+
      '<button class="dev-head-btn primary" id="dev-run">'+I.play+'<span class="dev-btn-label">Run</span></button>'+
      '<button class="dev-head-btn" id="dev-close" title="Exit Developer Mode" aria-label="Exit Developer Mode">'+I.close+'</button>'+
      '<input id="dev-file-picker" type="file" multiple hidden></header>'+
      '<div id="dev-body"><aside id="dev-explorer"><div class="dev-section-label"><span>PROJECT FILES</span><span class="dev-section-actions">'+
      '<button class="dev-pane-hide" id="dev-explorer-hide" type="button" title="Hide Project Files panel" aria-label="Hide Project Files panel">'+I.explorerHide+'</button>'+
      '<button class="dev-icon-btn" id="dev-new-file-toggle" title="New file" aria-label="New file">'+I.plus+'</button>'+
      '<button class="dev-icon-btn" id="dev-refresh-files" title="Refresh files" aria-label="Refresh files">'+I.refresh+'</button></span></div>'+
      '<div id="dev-file-list" role="list"></div><form class="dev-new-file" id="dev-new-file-form" hidden>'+
      '<input id="dev-new-file-name" placeholder="filename.js" aria-label="New file name" maxlength="100"><button type="submit" aria-label="Create file">+</button></form>'+
      '<p class="dev-explorer-foot">Saved locally in this browser. Folder sync and GitHub integration will be added separately.</p></aside>'+
      '<div class="dev-resize-handle" id="dev-explorer-resize" role="separator" aria-orientation="vertical" aria-label="Resize Project Files panel" aria-valuemin="170" aria-valuemax="420" tabindex="0"></div>'+
      '<main id="dev-center"><section id="dev-editor-panel"><div id="dev-editor-toolbar"><span id="dev-active-file-label">index.html</span>'+
      '<span class="dev-editor-actions"><button class="dev-tool-btn" id="dev-save">'+I.save+' Save</button><button class="dev-tool-btn" id="dev-preview-button">'+I.play+' Preview</button></span></div>'+
      '<div class="dev-editor-wrap"><textarea id="dev-editor" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Code editor"></textarea></div>'+
      '<div id="dev-editor-status"><span id="dev-cursor-status">Ln 1, Col 1</span><span id="dev-language-status">HTML · UTF-8</span></div></section>'+
      '<section id="dev-output-panel"><div id="dev-output-toolbar"><button class="dev-output-tab active" data-dev-output="console">Terminal</button>'+
      '<button class="dev-output-tab" data-dev-output="preview">Preview</button><span id="dev-output-spacer"></span>'+
      '<button id="dev-send-error" class="dev-output-tab" title="Send latest error to AI">Send Error to AI ↗</button><button id="dev-output-clear">Clear</button></div>'+
      '<div id="dev-output-lines" aria-live="polite"></div><iframe id="dev-preview-frame" title="Sandboxed project preview" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>'+
      '<div id="dev-terminal-bar"><span id="dev-terminal-prompt">dev&gt;</span><input id="dev-terminal-command" autocomplete="off" spellcheck="false" aria-label="Terminal command" placeholder="help · run · preview · ls">'+
      '<button id="dev-terminal-run">Run</button></div></section></main>'+
      '<div class="dev-resize-handle" id="dev-assistant-resize" role="separator" aria-orientation="vertical" aria-label="Resize AI Assistant panel" aria-valuemin="240" aria-valuemax="500" tabindex="0"></div>'+
      '<aside id="dev-assistant"><div id="dev-ai-model-row"><label for="dev-ai-model">Model</label><select id="dev-ai-model" aria-label="AI model"></select><button class="dev-pane-hide" id="dev-assistant-hide" type="button" title="Hide AI Assistant panel" aria-label="Hide AI Assistant panel">'+I.assistantHide+'</button></div>'+
      '<div id="dev-ai-messages"><div class="dev-empty">Describe what you want to build, ask for an explanation, or send an error to AI. The assistant can use your active file and project structure as context.</div></div>'+
      '<form id="dev-ai-composer"><textarea id="dev-ai-input" placeholder="Ask AI to build, debug or explain code…" maxlength="12000"></textarea>'+
      '<div id="dev-ai-send-row"><span id="dev-ai-hint">AI uses your connected LifeLink provider.</span><button id="dev-ai-send" type="submit">Ask AI ↗</button></div></form></aside></div>'+
      '<button class="dev-panel-reopen" id="dev-explorer-reopen" type="button" title="Show Project Files panel" aria-label="Show Project Files panel" hidden>'+I.explorerShow+'</button>'+
      '<button class="dev-panel-reopen" id="dev-assistant-reopen" type="button" title="Show AI Assistant panel" aria-label="Show AI Assistant panel" hidden>'+I.assistantShow+'</button>';
    document.body.appendChild(root);
    editor=$('#dev-editor');
    wire();
  }
  function updatePanelToggleStates() {
    const compact=window.matchMedia('(max-width: 620px)').matches;
    const drawer=window.matchMedia('(max-width: 900px)').matches;
    const explorerVisible=compact?root.classList.contains('explorer-open'):!root.classList.contains('explorer-collapsed');
    const assistantVisible=drawer?root.classList.contains('ai-open'):!root.classList.contains('assistant-collapsed');
    const explorerToggle=$('#dev-explorer-toggle'),aiToggle=$('#dev-ai-toggle');
    explorerToggle.setAttribute('aria-expanded',String(explorerVisible));
    explorerToggle.setAttribute('aria-label',explorerVisible?'Hide Project Files panel':'Show Project Files panel');
    explorerToggle.title=explorerVisible?'Hide Project Files panel':'Show Project Files panel';
    aiToggle.setAttribute('aria-expanded',String(assistantVisible));
    aiToggle.setAttribute('aria-label',assistantVisible?'Hide AI Assistant panel':'Show AI Assistant panel');
    aiToggle.title=assistantVisible?'Hide AI Assistant panel':'Show AI Assistant panel';
    $('#dev-explorer-reopen').hidden=explorerVisible;
    $('#dev-assistant-reopen').hidden=assistantVisible;
  }
  function toggleExplorerPanel(force) {
    const compact=window.matchMedia('(max-width: 620px)').matches;
    const drawer=window.matchMedia('(max-width: 900px)').matches;
    // The phone drawer and desktop column use opposite class conventions.
    const visible=force===undefined
      ? (compact ? !root.classList.contains('explorer-open') : root.classList.contains('explorer-collapsed'))
      : !!force;
    if(compact){
      root.classList.remove('explorer-collapsed');
      root.classList.toggle('explorer-open',visible);
    }else{
      root.classList.remove('explorer-open');
      root.classList.toggle('explorer-collapsed',!visible);
    }
    // Explorer and AI may both stay open on desktop; close only an overlapping AI drawer.
    if(visible&&drawer)root.classList.remove('ai-open');
    updatePanelToggleStates();
  }
  function toggleAssistantPanel(force) {
    const drawer=window.matchMedia('(max-width: 900px)').matches;
    const compact=window.matchMedia('(max-width: 620px)').matches;
    // Tablet/phone uses a drawer; desktop uses a collapsible grid column.
    const visible=force===undefined
      ? (drawer ? !root.classList.contains('ai-open') : root.classList.contains('assistant-collapsed'))
      : !!force;
    if(drawer){
      root.classList.remove('assistant-collapsed');
      root.classList.toggle('ai-open',visible);
    }else{
      root.classList.remove('ai-open');
      root.classList.toggle('assistant-collapsed',!visible);
    }
    // On phones the two drawers share the viewport; retain independent desktop column state.
    if(visible&&compact)root.classList.remove('explorer-open');
    updatePanelToggleStates();
  }
  function panelWidth(which) {
    const property=which==='explorer'?'--dev-explorer-width':'--dev-assistant-width';
    const fallback=which==='explorer'?226:328;
    const value=parseFloat(getComputedStyle(root).getPropertyValue(property));
    return Number.isFinite(value)&&value>0?value:fallback;
  }
  function applyPanelWidth(which,width) {
    const property=which==='explorer'?'--dev-explorer-width':'--dev-assistant-width';
    root.style.setProperty(property,Math.round(width)+'px');
    const handle=$('#dev-'+which+'-resize');
    if(handle)handle.setAttribute('aria-valuenow',String(Math.round(width)));
  }
  function savePanelLayout() {
    try{localStorage.setItem(key()+':layout',JSON.stringify({explorer:panelWidth('explorer'),assistant:panelWidth('assistant')}));}catch(e){}
  }
  function loadPanelLayout() {
    try{
      const saved=JSON.parse(localStorage.getItem(key()+':layout')||'null');
      if(saved&&Number.isFinite(saved.explorer))applyPanelWidth('explorer',Math.max(170,Math.min(420,saved.explorer)));
      if(saved&&Number.isFinite(saved.assistant))applyPanelWidth('assistant',Math.max(240,Math.min(500,saved.assistant)));
    }catch(e){}
  }
  function setupPanelResizing() {
    const handles=[['explorer',$('#dev-explorer-resize')],['assistant',$('#dev-assistant-resize')]];
    handles.forEach(([which,handle])=>{
      if(!handle)return;
      const resizeTo=clientX=>{
        const rect=$('#dev-body').getBoundingClientRect();
        const explorerWidth=which==='explorer'?clientX-rect.left:panelWidth('explorer');
        const assistantWidth=which==='assistant'?rect.right-clientX:panelWidth('assistant');
        if(which==='explorer'){
          const max=Math.max(170,Math.min(420,rect.width-assistantWidth-360-14));
          applyPanelWidth('explorer',Math.max(170,Math.min(max,explorerWidth)));
        }else{
          const max=Math.max(240,Math.min(500,rect.width-explorerWidth-360-14));
          applyPanelWidth('assistant',Math.max(240,Math.min(max,assistantWidth)));
        }
      };
      handle.addEventListener('pointerdown',event=>{
        if(window.matchMedia('(max-width: 900px)').matches)return;
        event.preventDefault();handle.setPointerCapture(event.pointerId);
        root.classList.add('resizing');
        const move=e=>resizeTo(e.clientX);
        const stop=()=>{
          handle.removeEventListener('pointermove',move);
          handle.removeEventListener('pointerup',stop);
          handle.removeEventListener('pointercancel',stop);
          root.classList.remove('resizing');savePanelLayout();
        };
        handle.addEventListener('pointermove',move);
        handle.addEventListener('pointerup',stop,{once:true});
        handle.addEventListener('pointercancel',stop,{once:true});
      });
      handle.addEventListener('keydown',event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        const direction=which==='explorer'?1:-1,step=event.shiftKey?40:16;
        let width=panelWidth(which);
        if(event.key==='Home')width=which==='explorer'?170:240;
        else if(event.key==='End')width=which==='explorer'?420:500;
        else width+=((event.key==='ArrowRight'?1:-1)*step*direction);
        applyPanelWidth(which,Math.max(which==='explorer'?170:240,Math.min(which==='explorer'?420:500,width)));
        savePanelLayout();
      });
    });
  }
  function wire() {
    $('#dev-close').addEventListener('click',close);
    $('#dev-explorer-toggle').addEventListener('click',()=>toggleExplorerPanel());
    $('#dev-ai-toggle').addEventListener('click',()=>toggleAssistantPanel());
    $('#dev-explorer-hide').addEventListener('click',()=>toggleExplorerPanel(false));
    $('#dev-assistant-hide').addEventListener('click',()=>toggleAssistantPanel(false));
    $('#dev-explorer-reopen').addEventListener('click',()=>toggleExplorerPanel(true));
    $('#dev-assistant-reopen').addEventListener('click',()=>toggleAssistantPanel(true));
    window.addEventListener('resize',updatePanelToggleStates,{passive:true});
    setupPanelResizing();
    $('#dev-run').addEventListener('click',runActive);
    $('#dev-preview-button').addEventListener('click',showPreview);
    $('#dev-save').addEventListener('click',()=>save(true));
    $('#dev-output-clear').addEventListener('click',clearLogs);
    $('#dev-send-error').addEventListener('click',sendError);
    $('#dev-open-files').addEventListener('click',()=>$('#dev-file-picker').click());
    $('#dev-file-picker').addEventListener('change',importFiles);
    $('#dev-download-file').addEventListener('click',downloadFile);
    $('#dev-new-file-toggle').addEventListener('click',()=>{
      const form=$('#dev-new-file-form'); form.hidden=!form.hidden; if(!form.hidden)$('#dev-new-file-name').focus();
    });
    $('#dev-new-file-form').addEventListener('submit',newFile);
    $('#dev-refresh-files').addEventListener('click',renderFiles);
    $('#dev-project-name').addEventListener('input',e=>{workspace.name=e.target.value.slice(0,60);scheduleSave();});
    editor.addEventListener('input',()=>{
      const file=current(); if(file)file.content=editor.value.slice(0,MAX_FILE);
      scheduleSave(); scheduleCursorUpdate();
    });
    editor.addEventListener('keydown',e=>{
      if(e.key==='Tab'){e.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.dispatchEvent(new Event('input',{bubbles:true}));}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();save(true);}
      if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();runActive();}
    });
    editor.addEventListener('click',scheduleCursorUpdate); editor.addEventListener('keyup',scheduleCursorUpdate);
    $('#dev-terminal-run').addEventListener('click',terminal);
    $('#dev-terminal-command').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();terminal();}});
    $('#dev-ai-composer').addEventListener('submit',e=>{e.preventDefault();askAI($('#dev-ai-input').value);});
    $('#dev-ai-model').addEventListener('change',e=>{if(typeof window.selectAIModel==='function')window.selectAIModel(e.target.value);syncAIModel();});
    root.addEventListener('click',e=>{
      const tab=e.target.closest('[data-dev-output]'); if(tab)setOutput(tab.dataset.devOutput);
      const exportButton=e.target.closest('[data-dev-export]');if(exportButton){e.preventDefault();e.stopPropagation();downloadFile(exportButton.dataset.devExport);return;}
      const deleteButton=e.target.closest('[data-dev-delete]');if(deleteButton){e.preventDefault();e.stopPropagation();deleteFile(deleteButton.dataset.devDelete);return;}
      const apply=e.target.closest('[data-dev-apply]'); if(apply)applyBlock(Number(apply.dataset.devApply));
      if(root.classList.contains('ai-open')&&!e.target.closest('#dev-assistant')&&!e.target.closest('#dev-ai-toggle')){
        root.classList.remove('ai-open');$('#dev-ai-toggle').setAttribute('aria-expanded','false');
      }
      if(root.classList.contains('explorer-open')&&!e.target.closest('#dev-explorer')&&!e.target.closest('#dev-explorer-toggle')){
        root.classList.remove('explorer-open');$('#dev-explorer-toggle').setAttribute('aria-expanded','false');
        $('#dev-explorer-toggle').setAttribute('aria-label','Expand Explorer');
      }
    });
    window.addEventListener('message',previewMessage);
    document.addEventListener('keydown',e=>{if(opened&&e.key==='Escape'){e.preventDefault();close();}});
  }
  function renderFiles() {
    const list=$('#dev-file-list'); if(!list||!workspace)return;
    list.innerHTML=workspace.files.map(f=>'<div class="dev-file-row"><button class="dev-file'+(f.name===activeFile?' active':'')+'" type="button" data-dev-file="'+esc(f.name)+'" title="'+esc(f.name)+'"><span class="dev-file-icon">'+esc(glyph(f.name))+'</span><span>'+esc(f.name)+'</span></button><span class="dev-file-actions"><button type="button" class="dev-file-action" data-dev-export="'+esc(f.name)+'" title="Export '+esc(f.name)+'" aria-label="Export '+esc(f.name)+'">'+I.download+'</button><button type="button" class="dev-file-action delete" data-dev-delete="'+esc(f.name)+'" title="Delete '+esc(f.name)+'" aria-label="Delete '+esc(f.name)+'">'+I.trash+'</button></span></div>').join('');
    list.querySelectorAll('[data-dev-file]').forEach(b=>b.addEventListener('click',()=>openFile(b.dataset.devFile)));
  }
  function openFile(name) {
    const file=workspace.files.find(f=>f.name===name); if(!file)return;
    if(name!==activeFile)flushSave(false);
    activeFile=name; editor.value=file.content;
    $('#dev-active-file-label').textContent=name;
    $('#dev-language-status').textContent=ext(name).toUpperCase()+' · UTF-8';
    renderFiles(); updateCursor(); editor.focus();
  }
  function scheduleCursorUpdate() {
    if(cursorTimer)return;
    cursorTimer=setTimeout(()=>{cursorTimer=null;updateCursor();},80);
  }
  function updateCursor() {
    const value=editor.value, position=editor.selectionStart;
    let line=1;
    for(let i=0;i<position;i++)if(value.charCodeAt(i)===10)line++;
    const breakAt=value.lastIndexOf('\n',position-1);
    $('#dev-cursor-status').textContent='Ln '+line+', Col '+(position-breakAt);
    $('#dev-language-status').textContent=ext(activeFile).toUpperCase()+' · '+value.length.toLocaleString()+' chars';
  }
  function newFile(e) {
    e.preventDefault();
    const input=$('#dev-new-file-name'), name=String(input.value||'').trim().replace(/\\/g,'/').split('/').pop();
    if(!name||!/^[\w.-]{1,100}$/.test(name)){tell('Use a simple filename, such as app.js');return;}
    if(workspace.files.some(f=>f.name.toLowerCase()===name.toLowerCase())){tell('That file already exists');return;}
    workspace.files.push({name,content:''}); input.value=''; $('#dev-new-file-form').hidden=true;
    save(false); renderFiles(); openFile(name);
  }
  async function importFiles(e) {
    const files=Array.from(e.target.files||[]);
    for(const file of files.slice(0,30)){
      if(file.size>500000){log('Skipped '+file.name+' (over 500 KB in this starter module).','warn');continue;}
      try{
        const content=await file.text(), name=file.name.replace(/[^\w.-]/g,'_').slice(0,100);
        const existing=workspace.files.find(f=>f.name===name);
        if(existing)existing.content=content.slice(0,MAX_FILE); else workspace.files.push({name,content:content.slice(0,MAX_FILE)});
      }catch(err){log('Could not import '+file.name+': '+err.message,'error');}
    }
    e.target.value=''; save(false); renderFiles();
    if(files[0])openFile(files[0].name.replace(/[^\w.-]/g,'_').slice(0,100));
    log('Imported '+files.length+' file(s).','result');
  }
  function downloadFile(name) {
    const file=name?workspace.files.find(f=>f.name===name):current();if(!file)return;
    const url=URL.createObjectURL(new Blob([file.content],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=file.name;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1200);log('Exported '+file.name,'result');
  }
  function deleteFile(name) {
    const index=workspace.files.findIndex(f=>f.name===name);if(index<0)return;
    if(workspace.files.length===1){tell('A project must keep at least one file.');return;}
    if(!window.confirm('Delete '+name+' from this project? This cannot be undone.'))return;
    flushSave(false);workspace.files.splice(index,1);
    if(activeFile===name)openFile(workspace.files[Math.min(index,workspace.files.length-1)].name);else renderFiles();
    save(false);tell('Deleted '+name);
  }
  function syncAIModel() {
    const source=$('#af-model'),target=$('#dev-ai-model');if(!source||!target)return;
    const selected=source.value||'auto';
    target.innerHTML=Array.from(source.options).map(option=>'<option value="'+esc(option.value)+'">'+esc(option.textContent)+'</option>').join('');
    target.value=selected;
    const provider=$('#dev-ai-provider'),availability=window.aiModelAvailability||{};
    if(provider)provider.textContent=selected==='auto'?'Auto · connected models':(availability[selected]?'Connected · '+target.selectedOptions[0].textContent:'Not connected');
  }
  function clearLogs() {
    logQueue.length=0;
    if(logFrame){cancelAnimationFrame(logFrame);logFrame=0;}
    lastErrorText='';
    const out=$('#dev-output-lines');if(out)out.textContent='';
  }
  function log(message,kind) {
    const value=String(message==null?'':message);
    const type=kind||'normal';
    if(type==='error')lastErrorText=value.slice(0,MAX_LOG_LINE);
    logQueue.push({text:value.slice(0,MAX_LOG_LINE),kind:type});
    if(!logFrame)logFrame=requestAnimationFrame(flushLogs);
  }
  function flushLogs() {
    logFrame=0;
    const out=$('#dev-output-lines');
    if(!out||!logQueue.length)return;
    const keepAtBottom=out.scrollHeight-out.scrollTop-out.clientHeight<48;
    const fragment=document.createDocumentFragment();
    for(const item of logQueue.splice(0)){
      const line=document.createElement('div');
      line.className='dev-output-line '+item.kind;
      line.textContent=item.text;
      fragment.appendChild(line);
    }
    out.appendChild(fragment);
    while(out.children.length>MAX_LOG)out.firstElementChild.remove();
    if(keepAtBottom)out.scrollTop=out.scrollHeight;
    if(logQueue.length&&!logFrame)logFrame=requestAnimationFrame(flushLogs);
  }
  function setOutput(mode) {
    outputMode=mode==='preview'?'preview':'console';
    root.querySelectorAll('[data-dev-output]').forEach(t=>t.classList.toggle('active',t.dataset.devOutput===outputMode));
    $('#dev-output-lines').style.display=outputMode==='console'?'block':'none';
    $('#dev-preview-frame').style.display=outputMode==='preview'?'block':'none';
  }

  function previewMessage(event) {
    const frame=$('#dev-preview-frame'), data=event.data;
    if(!frame||event.source!==frame.contentWindow||!data||data.__lifelinkDev!==true||data.token!==previewToken)return;
    const kind=data.type==='error'?'error':data.type==='warn'?'warn':data.type==='system'?'system':'normal';
    log((data.args||[]).join(' '),kind);
  }
  function makePreview(html,css,js) {
    const token=Math.random().toString(36).slice(2)+Date.now().toString(36); previewToken=token;
    const bridge='(function(){var token='+JSON.stringify(token)+';function safe(v){try{if(typeof v==="string")return v;if(v instanceof Error)return v.name+": "+v.message;return JSON.stringify(v)}catch(e){return String(v)}}function send(type,args){try{parent.postMessage({__lifelinkDev:true,token:token,type:type,args:Array.prototype.map.call(args||[],safe)},"*")}catch(e){}}["log","info","warn","error","debug"].forEach(function(k){var old=console[k];console[k]=function(){send(k,arguments);if(old)try{old.apply(console,arguments)}catch(e){}}});window.addEventListener("error",function(e){send("error",[e.message+" ("+e.filename+":"+e.lineno+")"])});window.addEventListener("unhandledrejection",function(e){send("error",["Unhandled promise rejection: "+safe(e.reason)])});window.addEventListener("load",function(){send("system",["Preview loaded"])})})();';
    let page=String(html||'').trim();
    if(!page)page='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>';
    page=page.replace(/<link\b[^>]*href=["'][^"']+\.css(?:\?[^"']*)?["'][^>]*>/gi,'');
    page=page.replace(/<script\b[^>]*src=["'][^"']+\.m?js(?:\?[^"']*)?["'][^>]*>\s*<\/script>/gi,'');
    const styles='<style>'+String(css||'').replace(/<\/style/gi,'<\\/style')+'</style>';
    const scripts='<script>'+bridge+'<\/script><script>'+String(js||'').replace(/<\/script/gi,'<\\/script')+'<\/script>';
    if(/<\/head>/i.test(page))page=page.replace(/<\/head>/i,styles+'</head>');
    else page=styles+page;
    if(/<\/body>/i.test(page))page=page.replace(/<\/body>/i,scripts+'</body>');
    else page+=scripts;
    return {page,token};
  }
  function projectPreview() {
    const htmlFile=workspace.files.find(f=>['html','htm'].includes(ext(f.name)));
    const cssFile=workspace.files.find(f=>ext(f.name)==='css');
    const jsFile=workspace.files.find(f=>['js','mjs'].includes(ext(f.name)));
    const html=htmlFile?htmlFile.content:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LifeLink preview</title></head><body><main><h1>Preview</h1></main></body></html>';
    const built=makePreview(html,cssFile?cssFile.content:'',jsFile?jsFile.content:'');
    const frame=$('#dev-preview-frame'); frame.setAttribute('sandbox','allow-scripts'); frame.srcdoc=built.page;
    setOutput('preview'); log('Starting isolated preview…','system');
  }
  function showPreview() {
    if(['html','htm','css','js','mjs'].includes(ext(activeFile)))projectPreview();
    else{setOutput('console');log('Preview currently supports HTML, CSS and JavaScript. Other runtimes will be added separately.','warn');}
  }
  function runActive() {
    const file=current(); if(!file)return; save(false);
    if(['html','htm','css','js','mjs'].includes(ext(file.name))){log('$ run '+file.name,'system');projectPreview();}
    else log('No browser runtime is loaded for .'+ext(file.name)+' yet. Additional runtimes will be lazy-loaded in later modules.','warn');
  }
  function terminal() {
    const input=$('#dev-terminal-command'), command=String(input.value||'').trim(); if(!command)return; input.value='';
    log('dev> '+command,'system');
    const parts=command.split(/\s+/), verb=parts.shift().toLowerCase(), arg=parts.join(' ');
    switch(verb){
      case 'help': log('Commands: help, clear, pwd, ls, cat <file>, open <file>, new <file>, echo <text>, date, run, preview, download, version'); log('Browser-native project console, not a Windows/Linux shell.','warn');break;
      case 'clear': clearLogs();break;
      case 'pwd': log('/lifelink/'+(workspace.name||'project'));break;
      case 'ls': workspace.files.forEach(f=>log(f.name));break;
      case 'cat': {const f=workspace.files.find(x=>x.name===arg);if(f)log(f.content);else log('File not found: '+arg,'error');break;}
      case 'open': openFile(arg); log(current()?'Opened '+arg:'File not found: '+arg,current()?'result':'error');break;
      case 'new': {
        const name=arg.replace(/[^\w.-]/g,'_').slice(0,100);
        if(!name){log('Usage: new filename.js','warn');break;}
        if(workspace.files.some(f=>f.name===name)){log('That file already exists.','warn');break;}
        workspace.files.push({name,content:''});save(false);renderFiles();openFile(name);break;
      }
      case 'echo':log(arg);break;
      case 'date':log(new Date().toString());break;
      case 'run':runActive();break;
      case 'preview':showPreview();break;
      case 'download':downloadFile();break;
      case 'version':log('LifeLink Dev '+VERSION);break;
      default:log('Unknown command: '+verb+' · type help for commands.','error');
    }
  }

  function renderAI(role,text,blocks) {
    const box=document.createElement('article'); box.className='dev-ai-message '+(role==='user'?'user':'assistant');
    if(role==='user')box.textContent=text;
    else{
      box.innerHTML=typeof window.formatMarkdownBasic==='function'?window.formatMarkdownBasic(text):'<p>'+esc(text)+'</p>';
      box.querySelectorAll('pre code').forEach(code=>{
        const index=blocks.push(code.textContent)-1, wrap=document.createElement('div'), btn=document.createElement('button');
        wrap.className='dev-ai-apply'; btn.type='button';btn.dataset.devApply=String(index);btn.textContent='Apply to active file';wrap.appendChild(btn);
        code.parentElement.parentElement.appendChild(wrap);
      });
    }
    $('#dev-ai-messages').appendChild(box); $('#dev-ai-messages').scrollTop=$('#dev-ai-messages').scrollHeight;
  }
  function applyBlock(index) {
    const code=latestCodeBlocks[index], file=current(); if(typeof code!=='string'||!file)return;
    if(!window.confirm('Replace the contents of '+file.name+' with this AI code block?'))return;
    file.content=code.slice(0,MAX_FILE); editor.value=file.content;save(false);updateCursor();
    log('AI code applied to '+file.name+'. Review it before running.','result');
  }
  function context() {
    return 'Project: '+workspace.name+'\nFiles: '+workspace.files.map(f=>f.name).join(', ')+'\nActive file: '+activeFile+'\n\nActive file contents:\n'+String(current()?.content||'').slice(0,18000);
  }
  async function askAI(value) {
    const prompt=String(value||'').trim(); if(!prompt||aiBusy)return;
    if(typeof window.ensureSupabaseClient==='function'){
      const ready=await window.ensureSupabaseClient();
      if(!ready){log('AI is unavailable: the LifeLink sign-in service could not be loaded.','error');return;}
    }
    if(typeof window.callLLM!=='function'){log('The connected LifeLink AI service is unavailable in this build.','error');return;}
    aiBusy=true;$('#dev-ai-send').disabled=true;$('#dev-ai-send').textContent='Thinking…';$('#dev-ai-input').value='';
    renderAI('user',prompt,[]);aiMessages.push({role:'user',text:prompt});
    const sys=[
      'You are LifeLink Dev, the coding assistant in a browser-based development workspace.',
      'Help write, explain, debug, review and refactor code. Be accurate about browser limitations.',
      'For a complete replacement file, provide one fenced code block and state which filename it is for.',
      'For focused edits, identify the exact change or provide the complete updated file when safer.',
      'Never claim code was executed unless the user ran it in the sandbox preview.',
      'The project preview runs in an isolated iframe and cannot access the LifeLink parent page or authentication storage.',
      'Project context:\n'+context()
    ].join('\n\n');
    try{
      const model=$('#af-model'), selected=model?model.value:'auto';
      const answer=String(await window.callLLM(aiMessages.slice(-14),{sys:sys,webSearch:false,timeout:90000})||'').trim()||'The AI returned an empty answer.';
      renderAI('assistant',answer,latestCodeBlocks);
      aiMessages.push({role:'assistant',text:answer});if(aiMessages.length>20)aiMessages=aiMessages.slice(-20);
      const provider=typeof S!=='undefined'&&S&&S.aiLastProvider?S.aiLastProvider:selected;
      $('#dev-ai-provider').textContent=provider||'LifeLink AI';status('AI response received');
    }catch(error){
      const message=String(error&&error.message||error);renderAI('assistant','AI request failed: '+message,[]);
      aiMessages.push({role:'assistant',text:'AI request failed: '+message});log('AI request failed: '+message,'error');
    }finally{
      aiBusy=false;$('#dev-ai-send').disabled=false;$('#dev-ai-send').textContent='Ask AI ↗';$('#dev-ai-input').focus();
    }
  }
  function sendError() {
    const lines=Array.from($('#dev-output-lines').children), item=[...lines].reverse().find(el=>el.classList.contains('error'));
    const errorText=lastErrorText||(item&&item.textContent);
    if(!errorText){tell('There is no recent error to send');return;}
    const prompt='Please diagnose this error and suggest a fix for my active file:\n\n'+errorText;
    $('#dev-ai-input').value=prompt;askAI(prompt);
  }
  function open() {
    if(opened)return;
    buildUI();workspace=load();
    root.classList.remove('closing','ai-open','explorer-open','explorer-collapsed','assistant-collapsed');
    loadPanelLayout();
    const compact=window.matchMedia('(max-width: 620px)').matches;
    const mobile=window.matchMedia('(max-width: 900px)').matches;
    $('#dev-ai-toggle').setAttribute('aria-expanded',String(!mobile));
    $('#dev-explorer-toggle').setAttribute('aria-expanded',String(!compact));
    $('#dev-explorer-toggle').setAttribute('aria-label',compact?'Show Project Files panel':'Hide Project Files panel');
    updatePanelToggleStates();
    if(!workspace.files.some(f=>f.name===activeFile))activeFile=workspace.files[0].name;
    $('#dev-project-name').value=workspace.name||'Untitled project';
    renderFiles();openFile(activeFile);
    if(typeof window.closeIsland==='function')window.closeIsland();
    if(typeof window.closeAIFull==='function')window.closeAIFull(true);
    document.body.dataset.devPreviousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    root.classList.add('open');opened=true;setOutput('console');
    syncAIModel();
    if(typeof window.refreshAIModelStatus==='function')Promise.resolve(window.refreshAIModelStatus()).then(syncAIModel).catch(syncAIModel);
    log('LifeLink Dev '+VERSION+' ready.','system');log('Browser-native workspace · type help for terminal commands.','system');
    setTimeout(()=>editor&&editor.focus(),80);
  }
  function close() {
    if(!opened||!root)return;
    flushSave(false);
    root.classList.remove('ai-open','explorer-open');
    $('#dev-ai-toggle').setAttribute('aria-expanded','false');
    $('#dev-explorer-toggle').setAttribute('aria-expanded','false');
    root.classList.add('closing');
    root.classList.remove('open');opened=false;
    document.body.style.overflow=document.body.dataset.devPreviousOverflow||'';
    const button=$('#dev-mode-launcher');if(button)button.focus();
  }
  window.addEventListener('pagehide',()=>{if(workspace)flushSave(false);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&workspace)flushSave(false);});
  window.LifeLinkDevMode={open:open,close:close,version:VERSION};
})();