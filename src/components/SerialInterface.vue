<template>
  <div class='serial-interface'>
    <h3>Current device: {{ currentDeviceStr }}</h3>

    <div class='buttons'>
      <button @click='onConnect' v-if='!port'>connect</button>
      <button @click='onDisconnect' v-if='port'>disconnect</button>
      <button @click='writeCommand("call:d")'>dump patch</button>
      <button @click='writeCommand("call:m")'>free memory</button>
      <button @click='onRestart'>restart</button>
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
import { PresetSchema } from '../gen/Preset_pb.ts'
import { fromBinary, type DescField } from '@bufbuild/protobuf'
import { base64Decode } from "@bufbuild/protobuf/wire";

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
const currentDeviceStr = ref("none")
const port = ref<SerialPort>()
const closing = ref(false)

const onConnect = async () => {
  port.value = await navigator.serial.requestPort();
  await port.value.open({ baudRate: 115200 });

  let lineReader = port.value.readable?.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream(new LineBreakTransformer())).getReader();

  writeCommand("call:i");

  while (true) {
    if (lineReader) {
      const { value } = await lineReader.read();
      console.log(value)
      if (value && value.indexOf("resp:") !== -1) {
        const m = value.match(/resp:([a-z]):(.*)/)

        if (m[1]) {
          switch (m[1]) {
            case "i":
              currentDeviceStr.value = m[2]
              break;
            case "d":
              lines.value = ["current patch: " + m[2]];
              lines.value.push("")
              const b64Decoded = base64Decode(m[2]);
              let decoded = fromBinary(PresetSchema, b64Decoded);
              PresetSchema.fields.forEach((f: DescField) => {
                lines.value.push(f.localName + ": " + (decoded as Record<string, any>)[f.localName])
              })

              break;
            case "m":
              lines.value = ["free memory: " + m[2] + " bytes"];
              break;
          }
        }
      }

      if (closing.value) {
        await lineReader.cancel()
        await port.value.close()
      }
    }
  }
}

const onDisconnect = async () => {
  window.location.reload();
  // TODO
  // streams are hard
  // 
  // closing.value = true
  // await port.value?.close()
  // port.value = undefined
  // currentDeviceStr.value = "none"
}

const onRestart = () => {
  writeCommand("restart");
  window.location.reload();
}

const writeCommand = async (command: string) => {
  const encoder = new TextEncoder();
  if (!port.value) { console.info("port is undefined"); return }
  if (!port.value.writable) { console.info("port is not writeable"); return }
  const writer = port.value.writable.getWriter();
  await writer.write(encoder.encode(command + "\n"));
  writer.releaseLock();
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

    li {
      min-height: 20px;
    }
  }
}
</style>
