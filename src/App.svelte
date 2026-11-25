<script lang="ts">
  import { open } from '@tauri-apps/plugin-dialog';
  import { onMount, untrack } from 'svelte';
  import {
    errorMessage,
    hasPassword,
    logsFolder,
    readData,
    readMobs,
    readRelics,
    startupArgs,
    tauriBackend,
    writeData,
    writeRelics,
  } from './core/backend';
  import { emptyAutomation, type AutomationFile } from './core/automation/model';
  import { loadAutomation, saveAutomation } from './core/automation/storage';
  import {
    buttonsFor,
    loadButtons,
    saveButtons,
    shortcutOf,
    type ActionButton,
    type ButtonsFile,
  } from './core/buttons/model';
  import { initialState, Session } from './core/session';
  import { parseEqsetConfig } from './nebbie/gear/legacyEqset';
  import { fromEqset, parseGearConfig } from './nebbie/gear/config';
  import { migrateAutoConfig, parseAutoConfig } from './nebbie/keep/autoConfig';
  import { loadPaths, savePaths } from './nebbie/paths/paths';
  import { parseMap } from './nebbie/map/model';
  import { loadProfiles, saveProfiles } from './nebbie/profiles/profileStorage';
  import {
    emptyFile,
    type Account,
    type Profile,
    type ProfilesFile,
  } from './nebbie/profiles/profiles';
  import AutomationEditor from './ui/AutomationEditor.svelte';
  import Bars from './ui/Bars.svelte';
  import ButtonBar from './ui/ButtonBar.svelte';
  import ButtonEditor from './ui/ButtonEditor.svelte';
  import GroupToggles from './ui/GroupToggles.svelte';
  import ConnectionBar from './ui/ConnectionBar.svelte';
  import InputLine from './ui/InputLine.svelte';
  import SequenceStrip from './ui/SequenceStrip.svelte';
  import DockLayout from './ui/dock/DockLayout.svelte';
  import LayoutMenu from './ui/dock/LayoutMenu.svelte';
  import MapZoneDialog from './ui/MapZoneDialog.svelte';
  import GearContainersDialog from './ui/GearContainersDialog.svelte';
  import SettingsDialog from './ui/SettingsDialog.svelte';
  import RelicContainerAsk from './ui/RelicContainerAsk.svelte';
  import RelicImportDialog from './ui/RelicImportDialog.svelte';
  import { containerNames } from './nebbie/relics/reliquiario';
  import SpellsEditor from './ui/SpellsEditor.svelte';
  import ScriptsEditor from './ui/ScriptsEditor.svelte';
  import { parseScripts } from './core/scripts/scripts';
  import { parseSpellFile, serializeSpellFile } from './nebbie/spells/abbreviations';
  import { Alerter } from './ui/alerts';
  import { defaultSettings, loadSettings, saveSettings, type Settings } from './core/settings';
  import { emptyLayouts, type LayoutsFile } from './ui/dock/layouts';
  import ProfileEditor from './ui/ProfileEditor.svelte';

  // Collegamento tra interfaccia e sessione: niente logica di dominio qui.
  const sessionState = $state(initialState());
  const session = new Session(tauriBackend, sessionState);
  // Solo in sviluppo: la sessione dalla console del browser, per il debug.
  if (import.meta.env.DEV) (window as unknown as { __nebbie: Session }).__nebbie = session;

  let profilesFile = $state<ProfilesFile>(emptyFile());
  let selectedId = $state<string | undefined>();
  let editorOpen = $state(false);
  let editorSection = $state<'account' | undefined>();
  let automation = $state<AutomationFile>(emptyAutomation());
  let automationOpen = $state(false);
  /** Finestra "in che zona registro" (interruttore MAPPER). */
  let mapZoneOpen = $state(false);
  /** Finestra dei contenitori del vestiario (con il set che aspetta, se c'è). */
  let gearContainers = $state<{ inAttesa?: string } | undefined>();
  /** Impostazioni (aspetto e avvisi) e finestra per cambiarle. */
  let settings = $state<Settings>(defaultSettings());
  let settingsOpen = $state(false);
  /** Abbreviazioni degli incantesimi (si apre dalla finestra Automazioni). */
  let spellsOpen = $state(false);
  /** Script utente (si apre dalla finestra Automazioni). */
  let scriptsOpen = $state(false);
  const alerter = new Alerter(() => settings);
  session.onAlert = (tipo, testo) => alerter.alert(tipo, testo);

  /** Tema, testo dell'output e scala dell'interfaccia sul documento. */
  function applySettings(s: Settings) {
    const root = document.documentElement;
    root.dataset.tema = s.tema;
    root.style.setProperty('--output-size', `${s.testo}px`);
    root.style.setProperty('zoom', String(s.scala / 100));
    session.alertHp = s.sogliaHp;
  }
  session.relicIo = { read: readRelics, write: writeRelics, readMobs };
  /** Identify in gioco in attesa della risposta "in che contenitore?". */
  let relicAsks = $state<{ chiave: string; nome: string; contenitore?: string }[]>([]);
  let relicImportOpen = $state(false);
  session.onAskRelicContainer = (o) => {
    if (!relicAsks.some((x) => x.chiave === o.chiave)) relicAsks = [...relicAsks, o];
  };
  session.openRelicImport = () => (relicImportOpen = true);
  session.onAskMapZone = () => (mapZoneOpen = true);
  session.gear.onAskContainers = (inAttesa) => (gearContainers = { inAttesa });
  let buttonsFile = $state<ButtonsFile>({ versione: 1, pulsanti: [] });
  let buttonsOpen = $state(false);
  const visibleButtons = $derived(buttonsFor(buttonsFile, selectedId));

  function pressButton(b: ActionButton) {
    void session.sendFromButton(b.etichetta, b.comando);
    inputLine.focus();
  }

  async function persistButtons(file: ButtonsFile) {
    buttonsFile = file;
    try {
      await saveButtons(file);
    } catch (e) {
      session.error(`Pulsanti non salvati: ${errorMessage(e)}`);
    }
  }
  let dock: DockLayout | undefined = $state();
  let layouts = $state<LayoutsFile>(emptyLayouts());
  let openIds = $state<string[]>([]);
  let output: { page(dir: 1 | -1): void } | null = null;
  let inputLine: InputLine;

  const selected = $derived(profilesFile.profili.find((p) => p.id === selectedId));

  // Vestiario per profilo (vestiario.json; al primo avvio convertito da eqset.json) e
  // impostazioni dei moduli (moduli.json).
  let eqsetConfigs: Record<string, unknown> = {};
  let gearConfigs: Record<string, unknown> | null = null;
  /** vestiario.json non leggibile: non si sovrascrive. */
  let gearReadFailed = false;
  let oldFabbroAuto = false;
  // Automatismi per profilo (automatismi.json; la prima volta dal vecchio moduli.json).
  let autoConfigs: Record<string, unknown> | null = null;
  let autoReadFailed = false;
  let oldSecondWind: { attivo?: boolean; soglia?: number } | undefined;

  // Durate degli incantesimi imparate, per profilo (durate.json): dipendono dal personaggio.
  let durations: Record<string, Record<string, number>> = {};
  session.onDurationsLearned = (d) => {
    if (!selectedId) return;
    durations = { ...durations, [selectedId]: d };
    writeData('durate', JSON.stringify(durations)).catch((e) =>
      session.error(`Durate degli incantesimi non salvate: ${errorMessage(e)}`),
    );
  };

  // Alias e trigger validi per il personaggio scelto (gruppi globali e del profilo).
  $effect(() => {
    session.setAutomation($state.snapshot(automation) as AutomationFile, selectedId);
  });

  async function persistAutomation(file: AutomationFile) {
    automation = file;
    try {
      await saveAutomation(file);
    } catch (e) {
      session.error(`Automazioni non salvate: ${errorMessage(e)}`);
    }
  }

  session.onTriggerDisabled = (t) => {
    const file = $state.snapshot(automation) as AutomationFile;
    file.trigger = file.trigger.map((x) => (x.id === t.id ? { ...x, attivo: false } : x));
    void persistAutomation(file);
  };

  function toggleGroup(id: string) {
    const file = $state.snapshot(automation) as AutomationFile;
    const g = file.gruppi.find((x) => x.id === id);
    if (!g) return;
    g.attivo = !g.attivo;
    void persistAutomation(file);
    session.system(`Gruppo "${g.nome}" ${g.attivo ? 'acceso' : 'spento'}.`);
  }

  /** Vestiario del profilo: da vestiario.json, oppure convertito dal vecchio eqset.json. */
  function gearFor(id: string) {
    if (gearConfigs?.[id]) return parseGearConfig(gearConfigs[id]);
    if (eqsetConfigs[id]) {
      const cfg = fromEqset(parseEqsetConfig(eqsetConfigs[id]));
      cfg.fabbro.automatico = oldFabbroAuto;
      return cfg;
    }
    return parseGearConfig(undefined);
  }

  // Cambiando personaggio (o modificandone il profilo) si applica il suo profilo: regex del
  // prompt, massimi, durate, vestiario. Solo `selected` fa ripartire l'effetto: il resto si
  // legge con untrack, altrimenti salvare durate o vestiario riapplicherebbe il profilo (e le
  // scritture sullo stato della sessione creerebbero un ciclo).
  $effect(() => {
    if (!selected) return;
    const profile = $state.snapshot(selected) as Profile;
    untrack(() => applyProfile(profile));
  });

  function applyProfile(profile: Profile) {
    try {
      session.setProfile(profile);
      session.setLearnedDurations(durations[profile.id] ?? {});
      const id = profile.id;
      session.setAutoConfig(
        autoConfigs?.[id] ? parseAutoConfig(autoConfigs[id]) : migrateAutoConfig(oldSecondWind),
        (cfg) => {
          if (autoReadFailed)
            return session.error('Automatismi non salvati: automatismi.json non era leggibile.');
          autoConfigs = { ...(autoConfigs ?? {}), [id]: $state.snapshot(cfg) };
          writeData('automatismi', JSON.stringify(autoConfigs, null, 2)).catch((e) =>
            session.error(`Automatismi non salvati: ${errorMessage(e)}`),
          );
        },
      );
      session.setGearConfig(gearFor(id), (cfg) => {
        if (gearReadFailed)
          return session.error('Vestiario non salvato: vestiario.json non era leggibile.');
        gearConfigs = { ...(gearConfigs ?? {}), [id]: cfg };
        writeData('vestiario', JSON.stringify(gearConfigs, null, 2)).catch((e) =>
          session.error(`Vestiario non salvato: ${errorMessage(e)}`),
        );
      });
    } catch (e) {
      session.error(`Profilo "${profile.nome}": ${errorMessage(e)}`);
    }
  }

  onMount(async () => {
    session.system('Nebbie Client pronto.');
    settings = await loadSettings();
    applySettings(settings);
    void session.relics.setFolder(settings.reliquiario);
    try {
      session.setScripts(parseScripts(await readData('script')));
      session.onScriptsChanged = (f) =>
        writeData('script', JSON.stringify(f)).catch((e) =>
          session.error(`Script non salvati: ${errorMessage(e)}`),
        );
    } catch (e) {
      session.error(`script.json non leggibile (non verrà sovrascritto): ${errorMessage(e)}`);
    }
    try {
      session.setSpells(parseSpellFile(await readData('abbreviazioni')));
      // si salva solo se il file è stato letto: uno danneggiato non va sovrascritto
      session.onSpellsChanged = (t) =>
        writeData('abbreviazioni', serializeSpellFile(t)).catch((e) =>
          session.error(`Abbreviazioni non salvate: ${errorMessage(e)}`),
        );
    } catch (e) {
      session.error(
        `abbreviazioni.json non leggibile (non verrà sovrascritto): ${errorMessage(e)}`,
      );
    }
    try {
      durations = JSON.parse((await readData('durate')) ?? '{}');
    } catch {
      durations = {};
    }
    try {
      eqsetConfigs = JSON.parse((await readData('eqset')) ?? '{}');
    } catch {
      eqsetConfigs = {};
    }
    try {
      const v = await readData('vestiario');
      gearConfigs = v ? JSON.parse(v) : null;
    } catch (e) {
      session.error(`vestiario.json non leggibile (non verrà sovrascritto): ${errorMessage(e)}`);
      gearConfigs = null;
      gearReadFailed = true;
    }
    try {
      const moduli = JSON.parse((await readData('moduli')) ?? '{}');
      oldFabbroAuto = moduli?.fabbro?.attivo === true;
      oldSecondWind = moduli?.secondWind;
    } catch {
      oldFabbroAuto = false;
    }
    try {
      const a = await readData('automatismi');
      autoConfigs = a ? JSON.parse(a) : null;
    } catch (e) {
      session.error(`automatismi.json non leggibile (non verrà sovrascritto): ${errorMessage(e)}`);
      autoReadFailed = true;
    }
    try {
      session.setMap(parseMap(await readData('mappa')));
      // Salvataggio qualche secondo dopo l'ultima modifica (camminando cambia a ogni passo);
      // solo se il file è stato letto: uno danneggiato non va sovrascritto.
      let mapTimer: ReturnType<typeof setTimeout> | undefined;
      session.onMapChanged = (data) => {
        clearTimeout(mapTimer);
        mapTimer = setTimeout(() => {
          writeData('mappa', JSON.stringify(data)).catch((e) =>
            session.error(`Mappa non salvata: ${errorMessage(e)}`),
          );
        }, 3000);
      };
    } catch (e) {
      session.error(`${errorMessage(e)} Le modifiche alla mappa non verranno salvate.`);
    }
    try {
      session.setPaths(await loadPaths());
      // Si salva solo se il file è stato letto: uno danneggiato non va sovrascritto.
      session.onPathsChanged = (file) => {
        savePaths(file).catch((e) => session.error(`Percorsi non salvati: ${errorMessage(e)}`));
      };
    } catch (e) {
      session.error(`${errorMessage(e)} Le modifiche ai percorsi non verranno salvate.`);
    }
    try {
      buttonsFile = await loadButtons();
    } catch (e) {
      session.error(errorMessage(e));
    }
    try {
      automation = await loadAutomation();
    } catch (e) {
      session.error(errorMessage(e));
    }
    try {
      profilesFile = await loadProfiles();
    } catch (e) {
      session.error(errorMessage(e));
    }
    selectedId = profilesFile.ultimo ?? profilesFile.profili[0]?.id;
    if (profilesFile.profili.length === 0) {
      session.system('Crea il profilo del tuo primo personaggio per collegarti.');
      editorOpen = true;
    }
    try {
      const args = await startupArgs();
      if (args) await session.startReplay(args.percorso, args.velocita);
    } catch (e) {
      session.error(errorMessage(e));
    }
    inputLine.focus();
  });

  async function persist(file: ProfilesFile) {
    try {
      await saveProfiles(file);
      profilesFile = file;
    } catch (e) {
      session.error(errorMessage(e));
    }
  }

  async function connect() {
    if (selectedId && profilesFile.ultimo !== selectedId) {
      await persist({ ...$state.snapshot(profilesFile), ultimo: selectedId } as ProfilesFile);
    }
    // L'account si passa alla sessione a ogni connessione, con lo stato della password.
    const account = $state.snapshot(profilesFile.account) as Account;
    let saved = false;
    if (account.accessoAutomatico && account.utente.trim()) {
      try {
        saved = await hasPassword(account.host, account.utente);
      } catch (e) {
        session.error(errorMessage(e));
      }
    }
    session.setAccount(account, saved);
    await session.connect();
    inputLine.focus();
  }

  async function toggleAutoLogin() {
    const file = $state.snapshot(profilesFile) as ProfilesFile;
    if (!file.account.utente.trim()) {
      session.system("Per l'accesso automatico imposta prima l'account in Profili….");
      editorSection = 'account';
      editorOpen = true;
      return;
    }
    file.account.accessoAutomatico = !file.account.accessoAutomatico;
    await persist(file);
    session.system(
      `Accesso automatico ${file.account.accessoAutomatico ? 'attivato' : 'disattivato'}.`,
    );
  }

  async function saveEditor(file: ProfilesFile, id: string | undefined) {
    await persist({ ...file, ultimo: id });
    selectedId = id;
    editorOpen = false;
    inputLine.focus();
  }

  async function replay(speed: number) {
    let defaultPath: string | undefined;
    try {
      defaultPath = await logsFolder();
    } catch {
      defaultPath = undefined;
    }
    const path = await open({
      title: 'Scegli un log da riprodurre',
      defaultPath,
      multiple: false,
      directory: false,
      filters: [{ name: 'Log', extensions: ['log', 'gz', 'txt'] }],
    });
    if (typeof path === 'string') await session.startReplay(path, speed);
    inputLine.focus();
  }

  // Scrivendo ovunque nella finestra il testo va nella riga di comando.
  function onWindowKeydown(e: KeyboardEvent) {
    const modal =
      editorOpen ||
      automationOpen ||
      buttonsOpen ||
      mapZoneOpen ||
      gearContainers !== undefined ||
      settingsOpen ||
      spellsOpen ||
      scriptsOpen ||
      relicImportOpen;
    // Scorciatoie dei pulsanti (F1-F12, ⌥1-⌥0): valgono anche mentre si scrive.
    const shortcut = modal ? null : shortcutOf(e);
    const button = shortcut && visibleButtons.find((b) => b.tasto === shortcut);
    if (button) {
      e.preventDefault();
      pressButton(button);
      return;
    }
    if (modal || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    if (e.key.length === 1 || e.key === 'Enter' || e.key.startsWith('Arrow')) inputLine.focus();
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<main>
  <ConnectionBar
    profiles={profilesFile.profili}
    bind:selectedId
    {sessionState}
    autoLogin={profilesFile.account.accessoAutomatico}
    ontoggleautologin={toggleAutoLogin}
    onconnect={connect}
    ondisconnect={() => session.disconnect()}
    oneditprofiles={() => {
      editorSection = undefined;
      editorOpen = true;
    }}
    onreplay={replay}
    onstopreplay={() => session.stopReplay()}
  >
    <LayoutMenu {dock} {layouts} {openIds} />
    <button onclick={() => (automationOpen = true)}>Automazioni…</button>
    <button onclick={() => (settingsOpen = true)}>Impostazioni…</button>
  </ConnectionBar>
  <GroupToggles
    groups={automation.gruppi}
    profileId={selectedId}
    ontoggle={toggleGroup}
    modules={[
      { id: 'fabbro', nome: 'Fabbro', attivo: sessionState.modules.fabbro },
      { id: 'mapper', nome: 'Mapper', attivo: sessionState.modules.mapper },
      { id: 'mantieni', nome: 'Mantieni attivi', attivo: sessionState.modules.mantieni },
      { id: 'regole', nome: 'Regole', attivo: sessionState.modules.regole },
    ]}
    onmodule={(id) => session.toggleModule(id)}
  />
  <DockLayout
    bind:this={dock}
    bind:layouts
    bind:openIds
    {session}
    {sessionState}
    onoutput={(o) => (output = o)}
  />
  <ButtonBar buttons={visibleButtons} onpress={pressButton} onedit={() => (buttonsOpen = true)} />
  <Bars vitals={sessionState.vitals} oro={sessionState.oro} />
  <SequenceStrip {session} {sessionState} />
  <InputLine bind:this={inputLine} {session} {sessionState} onpage={(d) => output?.page(d)} />
</main>

{#if buttonsOpen}
  <ButtonEditor
    file={buttonsFile}
    profiles={profilesFile.profili}
    onsave={(f) => {
      void persistButtons(f);
      buttonsOpen = false;
      inputLine.focus();
    }}
    onclose={() => {
      buttonsOpen = false;
      inputLine.focus();
    }}
  />
{/if}

{#if scriptsOpen}
  <ScriptsEditor
    file={session.scriptsFile}
    running={sessionState.scriptAttivi}
    tema={settings.tema}
    onsave={(f) => {
      session.setScripts(f, true);
      scriptsOpen = false;
    }}
    ontry={(s) => session.scripts.start(s)}
    onstop={(id) => session.scripts.stop(id)}
    onclose={() => {
      // chiudendo senza salvare, gli script provati e non salvati si fermano
      session.stopUnsavedScripts();
      scriptsOpen = false;
    }}
  />
{/if}

{#if spellsOpen}
  <SpellsEditor
    table={session.spells}
    allRows={[...session.allRows.values()]}
    onsave={(t) => {
      session.setSpells(t, true);
      spellsOpen = false;
    }}
    onclose={() => (spellsOpen = false)}
  />
{/if}

{#if relicAsks.length}
  {#key relicAsks[0].chiave}
    <RelicContainerAsk
      oggetto={relicAsks[0]}
      altri={relicAsks.length - 1}
      contenitori={containerNames(session.relics.db)}
      onanswer={(c) => {
        const o = relicAsks[0];
        relicAsks = relicAsks.slice(1);
        if (c !== undefined && c !== (o.contenitore ?? ''))
          void session.relics.setContainer(o.chiave, c);
        inputLine.focus();
      }}
    />
  {/key}
{/if}

{#if relicImportOpen}
  <RelicImportDialog
    contenitori={containerNames(session.relics.db)}
    onimport={(testo, contenitore) => {
      relicImportOpen = false;
      void session.relics.importText(testo, contenitore);
    }}
    onclose={() => (relicImportOpen = false)}
  />
{/if}

{#if settingsOpen}
  <SettingsDialog
    {settings}
    onpreview={applySettings}
    ontest={(k) => alerter.play(k)}
    onsave={(s) => {
      if (s.reliquiario !== settings.reliquiario) void session.relics.setFolder(s.reliquiario);
      settings = s;
      applySettings(s);
      saveSettings(s).catch((e) => session.error(`Impostazioni non salvate: ${errorMessage(e)}`));
      settingsOpen = false;
      inputLine.focus();
    }}
    onclose={() => {
      applySettings(settings);
      settingsOpen = false;
      inputLine.focus();
    }}
  />
{/if}

{#if mapZoneOpen}
  <MapZoneDialog
    zone={session.mapper.data.zone}
    attuale={session.mapper.current?.zona}
    onstart={(scelta) => {
      session.startMapping(scelta);
      mapZoneOpen = false;
      inputLine.focus();
    }}
    onclose={() => {
      mapZoneOpen = false;
      inputLine.focus();
    }}
  />
{/if}

{#if gearContainers}
  <GearContainersDialog
    cfg={session.gear.cfg}
    modello={session.gear.model.snapshot}
    inAttesa={gearContainers.inAttesa}
    onsave={(contenitori, destinazione) => {
      gearContainers = undefined;
      session.gear.setContainers(contenitori, destinazione);
      inputLine.focus();
    }}
    onclose={() => {
      gearContainers = undefined;
      session.gear.cancelContainers();
      inputLine.focus();
    }}
  />
{/if}

{#if automationOpen}
  <AutomationEditor
    onspells={() => (spellsOpen = true)}
    onscripts={() => (scriptsOpen = true)}
    file={automation}
    profiles={profilesFile.profili}
    activeProfileId={selectedId}
    onsave={(f) => {
      void persistAutomation(f);
      automationOpen = false;
      inputLine.focus();
    }}
    onclose={() => {
      automationOpen = false;
      inputLine.focus();
    }}
  />
{/if}

{#if editorOpen}
  <ProfileEditor
    file={profilesFile}
    {selectedId}
    section={editorSection}
    onsave={saveEditor}
    onclose={() => {
      editorOpen = false;
      inputLine.focus();
    }}
  />
{/if}

<style>
  main {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto 1fr auto auto auto auto;
    height: 100%;
  }
</style>
