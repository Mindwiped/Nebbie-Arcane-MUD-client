<script lang="ts">
  import { GLOBAL, type AutomationGroup } from '../core/automation/model';

  /** Interruttori in alto: un pulsante per ogni gruppo con "interruttore in alto". */
  let {
    groups,
    profileId,
    ontoggle,
    modules = [],
    onmodule,
  }: {
    groups: AutomationGroup[];
    profileId: string | undefined;
    ontoggle: (id: string) => void;
    /** Moduli con interruttore (fabbro, second wind…). */
    modules?: { id: string; nome: string; attivo: boolean }[];
    onmodule?: (id: string) => void;
  } = $props();

  const shown = $derived(
    groups.filter((g) => g.interruttore && (g.ambito === GLOBAL || g.ambito === profileId)),
  );
</script>

<!-- Sempre presente (anche vuota) perché occupa una riga della griglia della pagina. -->
<div
  class="toggles"
  class:empty={shown.length === 0 && modules.length === 0}
  role="toolbar"
  aria-label="Interruttori dei gruppi"
>
  {#each modules as m (m.id)}
    <button
      class:on={m.attivo}
      aria-pressed={m.attivo}
      title={m.attivo ? 'Acceso: clic per spegnere' : 'Spento: clic per accendere'}
      onclick={() => onmodule?.(m.id)}>{m.nome}: {m.attivo ? 'ON' : 'OFF'}</button
    >
  {/each}
  {#each shown as g (g.id)}
    <button
      class:on={g.attivo}
      aria-pressed={g.attivo}
      title={g.attivo ? 'Acceso: clic per spegnere' : 'Spento: clic per accendere'}
      onclick={() => ontoggle(g.id)}>{g.nome}: {g.attivo ? 'ON' : 'OFF'}</button
    >
  {/each}
</div>

<style>
  .toggles {
    display: flex;
    gap: 6px;
    padding: 4px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    overflow-x: auto;
  }
  .toggles.empty {
    padding: 0;
    border: 0;
  }
  button {
    flex: 1;
    max-width: 260px;
    padding: 3px 10px;
    border-color: var(--border);
    background: var(--bg-sunken);
    color: var(--text-dim);
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  button.on {
    border-color: var(--on-border);
    background: var(--on-bg);
    color: var(--on-text);
  }
</style>
