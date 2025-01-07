<template>
  <div class='serial-interface'>
    <div class='buttons'>
      <button @click='onConnect'>connect</button>
      <button>dump patch</button>
      <button>load patch</button>
    </div>

    <ol>
      <li v-for="line in lines">
        {{ line }}
      </li>
    </ol>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

// see https://wicg.github.io/serial/
class LineBreakTransformer {
  container: string;

  constructor() {
    this.container = '';
  }

  transform(chunk: string, controller: TransformStreamDefaultController) {
    this.container += chunk;
    const lines = this.container.split('\r\n');
    this.container = lines.pop() || '';
    lines.forEach(line => controller.enqueue(line));
  }

  flush(controller: TransformStreamDefaultController) {
    controller.enqueue(this.container);
  }
}

const lines = ref<Array<string>>([])

const onConnect = async () => {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate: 115200 });

  let lineReader = port.readable?.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream(new LineBreakTransformer())).getReader();

  while (port.readable && lineReader) {
    const { value, done } = await lineReader.read();
    if (value) {
      if (value.indexOf("export") == -1) {
        // TODO: regex, or better yet parse & support ANSI colours 
        lines.value.push(value.replace("[0;32m", "").replace("[0m", ""))
      }
    }
    if (done) {
      break;
    }
  }
}
</script>

<style scoped lang='scss'>
.serial-interface {
  .buttons {
    display: flex;
    gap: 10px;
  }

  ol {
    height: 60vh;
    overflow: scroll;
    overflow-wrap: break-word;

    padding: 8px;
    border: 1px solid black;
    margin: 20px 0 0 0;

    list-style: none;
  }
}
</style>
