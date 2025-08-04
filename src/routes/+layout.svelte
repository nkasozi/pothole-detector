<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';

  onMount(() => {
    // Register service worker for PWA functionality
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }
  });
</script>

<main>
  <slot />
</main>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: linear-gradient(135deg, #1f2937 0%, #111827 50%, #0f172a 100%);
    min-height: 100vh;
  }

  :global(html) {
    background: linear-gradient(135deg, #1f2937 0%, #111827 50%, #0f172a 100%);
    min-height: 100vh;
  }

  main {
    min-height: 100vh;
    width: 100%;
  }

  /* Custom scrollbar for webkit browsers */
  :global(::-webkit-scrollbar) {
    width: 8px;
  }

  :global(::-webkit-scrollbar-track) {
    background: #374151;
  }

  :global(::-webkit-scrollbar-thumb) {
    background: #6b7280;
    border-radius: 4px;
  }

  :global(::-webkit-scrollbar-thumb:hover) {
    background: #9ca3af;
  }
</style>