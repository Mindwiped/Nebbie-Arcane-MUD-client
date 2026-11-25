import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './eventBus';

interface TestEvents {
  prompt: { hp: number };
  mobKilled: { name: string };
}

describe('EventBus', () => {
  it('consegna i dati agli ascoltatori dell evento giusto', () => {
    const bus = new EventBus<TestEvents>();
    const onPrompt = vi.fn();
    const onMob = vi.fn();
    bus.on('prompt', onPrompt);
    bus.on('mobKilled', onMob);

    bus.emit('prompt', { hp: 481 });

    expect(onPrompt).toHaveBeenCalledWith({ hp: 481 });
    expect(onMob).not.toHaveBeenCalled();
  });

  it('la funzione restituita da on() toglie l ascoltatore', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();
    const off = bus.on('prompt', listener);
    off();
    bus.emit('prompt', { hp: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('un ascoltatore che fallisce non blocca gli altri', () => {
    const bus = new EventBus<TestEvents>();
    const errors: string[] = [];
    bus.onError = (_error, event) => errors.push(event);
    const second = vi.fn();
    bus.on('mobKilled', () => {
      throw new Error('rotto');
    });
    bus.on('mobKilled', second);

    bus.emit('mobKilled', { name: 'lo scheletro chierico' });

    expect(second).toHaveBeenCalledOnce();
    expect(errors).toEqual(['mobKilled']);
  });
});
