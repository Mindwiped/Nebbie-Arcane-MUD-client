import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('Elemento #app mancante in index.html');

export default mount(App, { target });
