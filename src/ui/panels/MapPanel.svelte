<script lang="ts">
  import { ask } from '@tauri-apps/plugin-dialog';
  import { onMount, untrack } from 'svelte';
  import type { Session, SessionState } from '../../core/session';
  import { DELTA, DIRS, type MapRoom } from '../../nebbie/map/model';
  import type { Dir } from '../../nebbie/parser/types';

  /**
   * Pannello Mappa (SPECIFICA 4.3): la zona e il piano della stanza attuale su un canvas.
   * Stanze quadrate col numero, linee per le uscite, tratto corto per le uscite non esplorate,
   * triangoli per su e giù, cerchio rosso sulla stanza attuale. Trascina per spostare, rotella
   * o +/− per lo zoom, clic su una stanza per le informazioni e "Vai qui".
   */
  let { session, sessionState }: { session: Session; sessionState: SessionState } = $props();

  let canvas: HTMLCanvasElement;
  let host: HTMLDivElement;
  let width = $state(300);
  let height = $state(300);
  let cell = $state(36);
  /** Zona e piano mostrati; centro della vista in coordinate della mappa. */
  let zona = $state<number | undefined>();
  let piano = $state(0);
  let cx = $state(0);
  let cy = $state(0);
  /** Segue la stanza attuale finché non trascini. */
  let follow = $state(true);
  let selected = $state<number | undefined>();
  let hover = $state<MapRoom | undefined>();
  /**
   * Selezione di più stanze (richiesta dell'utente del 2026-11-16): Maiusc+clic aggiunge o
   * toglie, Maiusc+trascina seleziona un rettangolo. Serve a spostare un pezzo di zona.
   */
  let scelte = $state<number[]>([]);
  /** Rettangolo di selezione in corso (pixel del canvas). */
  let rect = $state<{ x0: number; y0: number; x1: number; y1: number } | undefined>();
  /** Tema attuale: cambiandolo la mappa si ridisegna con i suoi colori. */
  let tema = $state(document.documentElement.dataset.tema ?? 'scuro');
  onMount(() => {
    const mo = new MutationObserver(
      () => (tema = document.documentElement.dataset.tema ?? 'scuro'),
    );
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });
    return () => mo.disconnect();
  });
  /** Menu del tasto destro su una stanza (per le isole: "Sposta isola nella zona"). */
  let menu = $state<{ x: number; y: number; id: number } | undefined>();
  /** "Unisci con…": stanza da tenere; il prossimo clic sceglie quella da togliere. */
  let merging = $state<number | undefined>();
  /** Ricerca e rinomina della zona (barra in basso). */
  let searching = $state(false);
  let query = $state('');
  let renaming = $state(false);
  let zoneName = $state('');
  /** Note e mob della stanza selezionata, in modifica. */
  let nota = $state('');
  let mobTxt = $state('');

  const data = $derived.by(() => {
    void sessionState.map.versione;
    // Il mapper modifica sempre lo stesso oggetto: una copia superficiale a ogni versione fa
    // ricalcolare l'elenco delle stanze (prima restava quello del caricamento, "92 stanze").
    return { ...session.mapper.data };
  });
  const cur = $derived(
    sessionState.map.cur !== undefined ? data.stanze[sessionState.map.cur] : undefined,
  );
  const zoneList = $derived([...data.zone].sort((a, b) => a.nome.localeCompare(b.nome, 'it')));
  const sel = $derived(selected !== undefined ? data.stanze[selected] : undefined);
  const zonaNome = (id?: number) => data.zone.find((z) => z.id === id)?.nome ?? '';

  // La vista segue la stanza attuale (zona, piano e centro).
  $effect(() => {
    if (!cur || !follow) return;
    zona = cur.zona;
    piano = cur.z;
    cx = cur.x;
    cy = cur.y;
  });
  $effect(() => {
    if (zona === undefined && data.zone.length) zona = data.zone[0].id;
  });

  const rooms = $derived(
    Object.values(data.stanze).filter((r) => r.zona === zona && r.z === piano),
  );

  function toScreen(x: number, y: number): [number, number] {
    return [width / 2 + (x - cx) * cell, height / 2 - (y - cy) * cell];
  }

  const sceltaSet = $derived(new Set(scelte));

  function draw() {
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // colori dal tema (variabili CSS --map-*)
    const css = getComputedStyle(document.documentElement);
    const c = (v: string) => css.getPropertyValue(v).trim() || '#888';
    ctx.fillStyle = c('--map-bg');
    ctx.fillRect(0, 0, width, height);
    // griglia leggera
    ctx.strokeStyle = c('--map-grid');
    ctx.lineWidth = 1;
    const ox = (width / 2 - cx * cell) % cell;
    const oy = (height / 2 + cy * cell) % cell;
    for (let x = ox; x < width; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = oy; y < height; y += cell) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const size = Math.max(8, cell * 0.56);
    const half = size / 2;
    const visible = rooms.filter((r) => {
      const [sx, sy] = toScreen(r.x, r.y);
      return sx > -cell && sx < width + cell && sy > -cell && sy < height + cell;
    });
    // uscite
    ctx.lineWidth = Math.max(1, cell / 18);
    for (const r of visible) {
      const [sx, sy] = toScreen(r.x, r.y);
      for (const d of DIRS) {
        if (d === 'u' || d === 'd') continue;
        const t = r.uscite[d];
        const [dx, dy] = DELTA[d];
        if (t !== undefined) {
          const b = data.stanze[t];
          if (b && b.zona === r.zona && b.z === r.z) {
            if (b.id < r.id && b.uscite[opp(d)] === r.id) continue; // già disegnata
            const [bx, by] = toScreen(b.x, b.y);
            ctx.strokeStyle = c('--map-exit');
            line(ctx, sx, sy, bx, by);
            if (b.uscite[opp(d)] !== r.id) arrow(ctx, sx, sy, bx, by); // senso unico
          } else {
            ctx.strokeStyle = c('--map-exit-other'); // verso un'altra zona o piano
            line(ctx, sx, sy, sx + dx * cell * 0.5, sy - dy * cell * 0.5);
          }
        } else if (r.viste.includes(d)) {
          ctx.strokeStyle = c('--map-exit-seen'); // uscita vista ma non esplorata
          line(ctx, sx + dx * half, sy - dy * half, sx + dx * cell * 0.42, sy - dy * cell * 0.42);
        }
      }
    }
    // stanze
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(8, Math.round(cell / 3.4))}px ui-monospace, monospace`;
    for (const r of visible) {
      const [sx, sy] = toScreen(r.x, r.y);
      const scelta = sceltaSet.has(r.id);
      ctx.fillStyle =
        r.colore ?? (r.id === selected || scelta ? c('--map-room-sel') : c('--map-room'));
      ctx.strokeStyle = r.id === selected ? c('--map-room-border-sel') : c('--map-room-border');
      ctx.lineWidth = 1.5;
      ctx.fillRect(sx - half, sy - half, size, size);
      ctx.strokeRect(sx - half, sy - half, size, size);
      if (scelta) {
        // stanza selezionata: bordo spesso del colore della stanza attuale
        ctx.strokeStyle = c('--map-cur');
        ctx.lineWidth = Math.max(2, cell / 12);
        ctx.strokeRect(sx - half - 2, sy - half - 2, size + 4, size + 4);
      }
      ctx.fillStyle = c('--map-text');
      if (cell >= 22) ctx.fillText(String(r.id), sx, sy);
      // stanza marcata con le monete: puntino dorato
      if (r.marca !== undefined) {
        ctx.fillStyle = c('--c-gold');
        ctx.beginPath();
        ctx.arc(sx - half * 0.6, sy + half * 0.6, Math.max(2, size * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }
      // su e giù
      ctx.fillStyle = c('--map-updown');
      if (r.uscite.u !== undefined || r.viste.includes('u'))
        tri(ctx, sx + half * 0.55, sy - half * 0.55, size * 0.18, true);
      if (r.uscite.d !== undefined || r.viste.includes('d'))
        tri(ctx, sx + half * 0.55, sy + half * 0.55, size * 0.18, false);
    }
    // rettangolo di selezione
    if (rect) {
      ctx.strokeStyle = c('--map-cur');
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      ctx.setLineDash([]);
    }
    // stanza attuale
    if (cur && cur.zona === zona && cur.z === piano) {
      const [sx, sy] = toScreen(cur.x, cur.y);
      ctx.strokeStyle = c('--map-cur');
      ctx.lineWidth = Math.max(2, cell / 10);
      ctx.beginPath();
      ctx.arc(sx, sy, size * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const OPPD: Record<Dir, Dir> = {
    n: 's',
    s: 'n',
    e: 'w',
    w: 'e',
    ne: 'sw',
    sw: 'ne',
    nw: 'se',
    se: 'nw',
    u: 'd',
    d: 'u',
  };
  const opp = (d: Dir) => OPPD[d];

  function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function arrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const l = cell * 0.18;
    ctx.beginPath();
    ctx.moveTo(mx + Math.cos(a) * l, my + Math.sin(a) * l);
    ctx.lineTo(mx + Math.cos(a + 2.5) * l, my + Math.sin(a + 2.5) * l);
    ctx.lineTo(mx + Math.cos(a - 2.5) * l, my + Math.sin(a - 2.5) * l);
    ctx.closePath();
    ctx.fillStyle = ctx.strokeStyle as string;
    ctx.fill();
  }

  function tri(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, up: boolean) {
    ctx.beginPath();
    ctx.moveTo(x, up ? y - s : y + s);
    ctx.lineTo(x - s, up ? y + s * 0.6 : y - s * 0.6);
    ctx.lineTo(x + s, up ? y + s * 0.6 : y - s * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  // ridisegna a ogni cambio di mappa, vista o dimensione
  $effect(() => {
    void [rooms, cur, cell, cx, cy, width, height, selected, piano, zona, tema, scelte, rect];
    draw();
  });

  onMount(() => {
    const measure = () => {
      const r = host.getBoundingClientRect();
      if (r.width > 0) width = r.width;
      if (r.height > 0) height = r.height;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  });

  function roomAt(px: number, py: number): MapRoom | undefined {
    const half = Math.max(8, cell * 0.56) / 2 + 2;
    return rooms.find((r) => {
      const [sx, sy] = toScreen(r.x, r.y);
      return Math.abs(px - sx) <= half && Math.abs(py - sy) <= half;
    });
  }

  let drag: {
    x: number;
    y: number;
    cx: number;
    cy: number;
    moved: boolean;
    /** Maiusc premuto: trascinando si disegna il rettangolo di selezione. */
    sel: boolean;
  } | null = null;

  function down(e: PointerEvent) {
    menu = undefined;
    if (e.button !== 0) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // puntatore non catturabile (eventi simulati): il trascinamento funziona lo stesso
    }
    drag = { x: e.offsetX, y: e.offsetY, cx, cy, moved: false, sel: e.shiftKey };
  }
  function move(e: PointerEvent) {
    if (drag) {
      const dx = e.offsetX - drag.x;
      const dy = e.offsetY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      if (drag.moved && drag.sel) rect = { x0: drag.x, y0: drag.y, x1: e.offsetX, y1: e.offsetY };
      else if (drag.moved) {
        follow = false;
        cx = drag.cx - dx / cell;
        cy = drag.cy + dy / cell;
      }
    } else hover = roomAt(e.offsetX, e.offsetY);
  }
  function contextMenu(e: MouseEvent) {
    e.preventDefault();
    drag = null;
    const r = roomAt(e.offsetX, e.offsetY);
    menu = r ? { x: e.offsetX, y: e.offsetY, id: r.id } : undefined;
  }
  const menuRoom = $derived(menu ? data.stanze[menu.id] : undefined);
  const isIsland = (id?: number) => data.zone.find((z) => z.id === id)?.tipo === 'isola';
  /** Zone in cui si può spostare un'isola (le zone vere, non altre isole). */
  const targets = $derived(zoneList.filter((z) => z.tipo === 'mondo'));
  /**
   * "Sposta in un'altra zona…": la stanza o tutto il suo gruppo collegato, in una zona esistente
   * o in una nuova (richiesta dell'utente del 2026-11-16).
   */
  let moving = $state<
    | {
        id: number;
        gruppo: number;
        cosa: 'gruppo' | 'stanza' | 'selezione';
        modo: 'esistente' | 'nuova';
        zona?: number;
        nome: string;
      }
    | undefined
  >();
  const moveTargets = $derived(
    moving ? targets.filter((z) => z.id !== data.stanze[moving!.id]?.zona) : [],
  );
  function startMove(id: number) {
    menu = undefined;
    const r = data.stanze[id];
    if (!r) return;
    const altre = targets.filter((z) => z.id !== r.zona);
    moving = {
      id,
      gruppo: session.mapper.groupOf(id).length,
      cosa: scelte.includes(id) ? 'selezione' : 'gruppo',
      modo: altre.length ? 'esistente' : 'nuova',
      zona: altre[0]?.id,
      nome: '',
    };
  }
  const moveOk = $derived(
    !!moving && (moving.modo === 'esistente' ? moving.zona !== undefined : !!moving.nome.trim()),
  );
  function doMove() {
    const m = moving;
    if (!m || !moveOk) return;
    moving = undefined;
    const ids =
      m.cosa === 'selezione'
        ? [...scelte]
        : m.cosa === 'stanza'
          ? [m.id]
          : session.mapper.groupOf(m.id);
    const to = session.moveRooms(
      ids,
      m.modo === 'esistente' ? { zona: m.zona! } : { nuova: m.nome.trim() },
    );
    if (to === undefined) return;
    scelte = [];
    selected = m.id;
    pickZone(to);
    // la vista segue te solo se ti sei spostato con le stanze; altrimenti resta sulla zona d'arrivo
    follow = cur !== undefined && ids.includes(cur.id);
  }

  function toggle(id: number) {
    scelte = scelte.includes(id) ? scelte.filter((x) => x !== id) : [...scelte, id];
  }
  function selectGroup(id: number) {
    menu = undefined;
    scelte = [...new Set([...scelte, ...session.mapper.groupOf(id)])];
  }

  function up(e: PointerEvent) {
    if (rect) {
      // stanze dentro il rettangolo (zona e piano mostrati)
      const [ax, bx] = [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1)];
      const [ay, by] = [Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)];
      const dentro = rooms
        .filter((r) => {
          const [sx, sy] = toScreen(r.x, r.y);
          return sx >= ax && sx <= bx && sy >= ay && sy <= by;
        })
        .map((r) => r.id);
      scelte = [...new Set([...scelte, ...dentro])];
      rect = undefined;
    } else if (drag && !drag.moved) {
      const r = roomAt(e.offsetX, e.offsetY);
      if (merging !== undefined && r && r.id !== merging) void merge(merging, r.id);
      else if (r && (e.shiftKey || e.metaKey || e.ctrlKey)) toggle(r.id);
      else selected = r?.id;
    }
    drag = null;
  }

  async function merge(keep: number, drop: number) {
    merging = undefined;
    const a = data.stanze[keep];
    const b = data.stanze[drop];
    if (!a || !b) return;
    const ok = await ask(
      `La stanza ${drop} "${b.titolo}" sparisce dentro la ${keep} "${a.titolo}": uscite, note e mob passano alla ${keep}.`,
      { title: 'Unisci le stanze', kind: 'warning', okLabel: 'Unisci', cancelLabel: 'Annulla' },
    );
    if (!ok) return;
    session.mergeRooms(keep, drop);
    selected = keep;
  }

  async function remove(id: number) {
    menu = undefined;
    const r = data.stanze[id];
    if (!r) return;
    const ok = await ask(`Cancello la stanza ${id} "${r.titolo}" e le uscite che portano lì?`, {
      title: 'Elimina stanza',
      kind: 'warning',
      okLabel: 'Elimina',
      cancelLabel: 'Annulla',
    });
    if (!ok) return;
    session.deleteRoom(id);
    if (selected === id) selected = undefined;
  }

  function startMerge(id: number) {
    menu = undefined;
    merging = id;
  }

  // note e mob: si ricaricano solo quando cambia la stanza selezionata
  $effect(() => {
    const id = selected;
    untrack(() => {
      const r = id !== undefined ? session.mapper.data.stanze[id] : undefined;
      nota = r?.note ?? '';
      mobTxt = (r?.mob ?? []).join(', ');
    });
  });
  function saveNotes() {
    if (sel) session.mapper.setNotes(sel.id, nota, mobTxt.split(','));
  }

  const results = $derived.by(() => {
    void data;
    return searching ? session.mapper.search(query, 30) : [];
  });
  function showRoom(r: MapRoom) {
    follow = false;
    zona = r.zona;
    piano = r.z;
    cx = r.x;
    cy = r.y;
    selected = r.id;
  }
  function startRename() {
    zoneName = zonaNome(zona);
    renaming = true;
  }
  function saveRename() {
    if (zona !== undefined && zoneName.trim()) session.mapper.renameArea(zona, zoneName.trim());
    renaming = false;
  }
  function wheel(e: WheelEvent) {
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }
  function zoom(f: number) {
    cell = Math.min(90, Math.max(10, cell * f));
  }
  function center() {
    follow = true;
    if (cur) {
      zona = cur.zona;
      piano = cur.z;
      cx = cur.x;
      cy = cur.y;
    }
  }
  function pickZone(id: number) {
    follow = false;
    if (id !== zona) scelte = [];
    zona = id;
    const rs = Object.values(data.stanze).filter((r) => r.zona === id);
    if (rs.length) {
      piano = rs[0].z;
      cx = rs[0].x;
      cy = rs[0].y;
    }
  }

  const exitsText = (r: MapRoom) =>
    DIRS.filter((d) => r.uscite[d] !== undefined)
      .map((d) => `${d}→${r.uscite[d]}`)
      .concat(r.viste.filter((d) => r.uscite[d] === undefined).map((d) => `${d}?`))
      .concat(Object.entries(r.speciali ?? {}).map(([c, t]) => `"${c}"→${t}`))
      .join('  ');
</script>

<div class="panel">
  <div class="title">
    {#if cur}{cur.titolo} <small>/ {cur.id} ({zonaNome(cur.zona)})</small>
    {:else if Object.keys(data.stanze).length}<span class="dim">posizione sconosciuta</span>
    {:else}<span class="dim">mappa vuota: cammina e si disegna da sola</span>{/if}
  </div>
  <div class="map" bind:this={host}>
    <canvas
      bind:this={canvas}
      style="width:{width}px;height:{height}px"
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      onpointerleave={() => (hover = undefined)}
      onwheel={wheel}
      oncontextmenu={contextMenu}
    ></canvas>
    {#if menu && menuRoom}
      <div
        class="menu"
        style="left:{Math.min(menu.x, width - 230)}px;top:{Math.min(menu.y, height - 40)}px"
        role="menu"
        tabindex="-1"
        onkeydown={(e) => e.key === 'Escape' && (menu = undefined)}
      >
        <div class="menu-head">#{menuRoom.id} · {menuRoom.titolo}</div>
        <button
          role="menuitem"
          disabled={menuRoom.id === cur?.id}
          onclick={() => (session.goToRoom(menuRoom.id), (menu = undefined))}>Vai qui</button
        >
        <button
          role="menuitem"
          onclick={() => (session.mapper.setCurrent(menuRoom.id), (menu = undefined))}
          >Sono qui</button
        >
        <button role="menuitem" onclick={() => startMerge(menuRoom.id)}>Unisci con…</button>
        <button role="menuitem" onclick={() => ((menu = undefined), toggle(menuRoom.id))}
          >{scelte.includes(menuRoom.id)
            ? 'Togli dalla selezione'
            : 'Aggiungi alla selezione'}</button
        >
        <button role="menuitem" onclick={() => selectGroup(menuRoom.id)}
          >Seleziona il gruppo collegato</button
        >
        <button role="menuitem" onclick={() => remove(menuRoom.id)}>Elimina stanza</button>
        <button role="menuitem" onclick={() => startMove(menuRoom.id)}
          >{scelte.includes(menuRoom.id)
            ? `Sposta le ${scelte.length} stanze selezionate…`
            : isIsland(menuRoom.zona)
              ? 'Sposta isola in una zona…'
              : "Sposta in un'altra zona…"}</button
        >
        <button role="menuitem" class="dim" onclick={() => (menu = undefined)}>Chiudi</button>
      </div>
    {/if}
    {#if scelte.length && merging === undefined && !moving}
      <div class="banner">
        {scelte.length}
        {scelte.length === 1 ? 'stanza selezionata' : 'stanze selezionate'}
        <button onclick={() => startMove(scelte[0])}>Sposta…</button>
        <button onclick={() => (scelte = [])}>Deseleziona</button>
      </div>
    {/if}
    {#if merging !== undefined}
      <div class="banner">
        Clicca la stanza da unire alla {merging}
        <button onclick={() => (merging = undefined)}>Annulla</button>
      </div>
    {/if}
    {#if moving}
      {@const mr = data.stanze[moving.id]}
      <div
        class="mover"
        role="dialog"
        aria-label="Sposta stanze"
        tabindex="-1"
        onkeydown={(e) => {
          if (e.key === 'Escape') moving = undefined;
          if (e.key === 'Enter') doMove();
        }}
      >
        <b>Sposta in un'altra zona</b>
        <small class="dim">#{mr?.id} · {mr?.titolo} — ora in "{zonaNome(mr?.zona ?? -1)}"</small>
        {#if !isIsland(mr?.zona) || moving.cosa === 'selezione'}
          {#if scelte.length}
            <label
              ><input type="radio" bind:group={moving.cosa} value="selezione" /> le stanze
              selezionate ({scelte.length})</label
            >
          {/if}
          <label
            ><input type="radio" bind:group={moving.cosa} value="gruppo" /> tutto il gruppo
            collegato ({moving.gruppo}
            {moving.gruppo === 1 ? 'stanza' : 'stanze'})</label
          >
          <label
            ><input type="radio" bind:group={moving.cosa} value="stanza" /> solo questa stanza</label
          >
        {:else}
          <small>tutta l'isola ({moving.gruppo} stanze)</small>
        {/if}
        <hr />
        <label class:off={!moveTargets.length}
          ><input
            type="radio"
            bind:group={moving.modo}
            value="esistente"
            disabled={!moveTargets.length}
          />
          nella zona
          <select bind:value={moving.zona} disabled={moving.modo !== 'esistente'}>
            {#each moveTargets as z (z.id)}<option value={z.id}>{z.nome}</option>{/each}
          </select></label
        >
        <label
          ><input type="radio" bind:group={moving.modo} value="nuova" /> in una zona nuova:
          <input
            type="text"
            placeholder="nome della zona"
            bind:value={moving.nome}
            onfocus={() => moving && (moving.modo = 'nuova')}
          /></label
        >
        <div class="mover-btn">
          <button onclick={() => (moving = undefined)}>Annulla</button>
          <button class="primary" disabled={!moveOk} onclick={doMove}>Sposta</button>
        </div>
      </div>
    {/if}
    {#if searching}
      <div class="search">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="search"
          placeholder="numero, titolo, nota, mob…"
          bind:value={query}
          autofocus
          onkeydown={(e) => e.key === 'Escape' && (searching = false)}
        />
        {#each results as r (r.id)}
          <button onclick={() => showRoom(r)}
            >{r.id} · {r.titolo} <small>{zonaNome(r.zona)}</small></button
          >
        {:else}
          {#if query.trim()}<small class="dim">niente</small>{/if}
        {/each}
      </div>
    {/if}
    {#if hover}<div class="tip">{hover.id} · {hover.titolo}</div>{/if}
  </div>
  <div class="bar">
    <button title="Ingrandisci" onclick={() => zoom(1.25)}>+</button>
    <button title="Rimpicciolisci" onclick={() => zoom(0.8)}>−</button>
    <button title="Centra sulla stanza attuale" class:on={follow} onclick={center}>◎</button>
    {#if renaming}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="zname"
        bind:value={zoneName}
        autofocus
        onkeydown={(e) => {
          if (e.key === 'Enter') saveRename();
          if (e.key === 'Escape') renaming = false;
        }}
        onblur={saveRename}
      />
    {:else}
      <select
        value={zona}
        onchange={(e) => pickZone(Number((e.target as HTMLSelectElement).value))}
      >
        {#each zoneList as z (z.id)}<option value={z.id}>{z.nome}</option>{/each}
      </select>
    {/if}
    <button title="Rinomina la zona" disabled={zona === undefined} onclick={startRename}>✎</button>
    <button title="Cerca una stanza" class:on={searching} onclick={() => (searching = !searching)}
      >⌕</button
    >
    <span class="z" title="Piano">
      <button onclick={() => ((follow = false), (piano += 1))}>▲</button>
      {piano}
      <button onclick={() => ((follow = false), (piano -= 1))}>▼</button>
    </span>
    <small class="dim">{Object.keys(data.stanze).length} stanze</small>
  </div>
  {#if sel}
    <div class="info">
      <div class="info-head">
        <b>{sel.titolo}</b> <small>#{sel.id} · {zonaNome(sel.zona)}</small>
        <button class="x" onclick={() => (selected = undefined)}>✕</button>
      </div>
      <small class="exits">{exitsText(sel)}</small>
      <div class="move">
        <button onclick={() => startMove(sel.id)}
          >{isIsland(sel.zona) ? 'Sposta isola in una zona…' : "Sposta in un'altra zona…"}</button
        >
      </div>
      <label class="field"
        >Note <textarea rows="2" bind:value={nota} onblur={saveNotes}></textarea></label
      >
      <label class="field"
        >Mob <input
          bind:value={mobTxt}
          placeholder="separati da virgola"
          onblur={saveNotes}
        /></label
      >
      {#if sel.marca}<small class="coins">● marcata con {sel.marca} monete</small>{/if}
      {#if sel.desc}<p class="desc">{sel.desc}</p>{/if}
      <div class="row">
        <button
          class="primary"
          disabled={sel.id === cur?.id}
          onclick={() => session.goToRoom(sel.id)}>Vai qui</button
        >
        <button onclick={() => session.mapper.setCurrent(sel.id)} title="Dice al mapper che sei qui"
          >Sono qui</button
        >
        <button onclick={() => startMerge(sel.id)} title="Questa stanza e un'altra sono la stessa"
          >Unisci con…</button
        >
        <button onclick={() => remove(sel.id)}>Elimina</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    font-size: 13px;
  }
  .title {
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .map {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  canvas {
    display: block;
    cursor: grab;
    touch-action: none;
  }
  .menu {
    position: absolute;
    z-index: 5;
    display: flex;
    flex-direction: column;
    min-width: 180px;
    max-width: 220px;
    max-height: 70%;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    box-shadow: 0 8px 24px #000a;
  }
  .menu button {
    text-align: left;
    border: 0;
    background: none;
    padding: 4px 8px;
  }
  .menu button:hover:not(:disabled) {
    background: var(--border);
  }
  .menu-head {
    padding: 4px 8px 2px;
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .move {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 4px 0;
    font-size: 12px;
  }
  .banner {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 10px;
    border-radius: 4px;
    background: #e5c07b;
    color: #000;
    font-size: 12px;
  }
  .mover {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: min(340px, calc(100% - 12px));
    max-height: calc(100% - 12px);
    overflow-y: auto;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
    box-shadow: 0 8px 30px #0008;
    font-size: 12px;
  }
  .mover label {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mover label.off {
    opacity: 0.5;
  }
  .mover select,
  .mover input[type='text'] {
    flex: 1;
    min-width: 0;
  }
  .mover hr {
    width: 100%;
    margin: 2px 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
  .mover-btn {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
  .search {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 4;
    display: flex;
    flex-direction: column;
    width: min(260px, calc(100% - 12px));
    max-height: 70%;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-panel);
  }
  .search button {
    text-align: left;
    border: 0;
    background: none;
    padding: 3px 6px;
  }
  .search button:hover {
    background: var(--border);
  }
  .zname {
    flex: 1;
    min-width: 0;
  }
  .field {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    margin: 4px 0;
    font-size: 12px;
  }
  .field textarea,
  .field input {
    flex: 1;
    min-width: 0;
    font: inherit;
  }
  .tip {
    position: absolute;
    left: 6px;
    bottom: 6px;
    padding: 2px 6px;
    background: var(--tip-bg);
    border-radius: 3px;
    font-size: 12px;
    pointer-events: none;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-top: 1px solid var(--border);
  }
  .bar select {
    flex: 1;
    min-width: 0;
  }
  button {
    padding: 1px 7px;
    font-size: 12px;
  }
  button.on {
    color: var(--map-cur);
  }
  .z {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 12px;
  }
  .info {
    padding: 6px 8px;
    border-top: 1px solid var(--border);
    max-height: 40%;
    overflow-y: auto;
  }
  .info-head {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .info-head .x {
    margin-left: auto;
    border: 0;
    background: none;
    color: var(--text-dim);
  }
  .exits {
    font-family: var(--font-mono);
  }
  .coins {
    display: block;
    color: var(--c-gold);
  }
  .desc {
    margin: 4px 0;
    font-size: 12px;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }
  small,
  .dim {
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
