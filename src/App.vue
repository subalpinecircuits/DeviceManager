<script setup lang="ts">
import SerialInterface from './components/SerialInterface.vue'
</script>

<template>
  <h1>Device Manager</h1>
  <SerialInterface />
  <a class="guide-link" href="https://subalpinecircuits.com/sa-01-beta-testing/" target="_blank">
    beta testing user guide
  </a>
</template>

<style scoped>
a.guide-link {
  margin-top: 10px;
}
</style>
