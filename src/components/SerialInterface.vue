<template>
  <div class='serial-interface'>
    <h3>Current device: {{ currentDeviceStr }}</h3>

    <div class='buttons'>
      <button @click='onConnect' v-if='!port'>connect</button>
      <button @click='onDisconnect' v-if='port'>disconnect</button>
      <button @click='writeCommand("call:d")'>dump patch</button>
      <button @click='writeCommand("call:m")'>free memory</button>
      <button @click='onInspect'>inspect patch</button>
      <button @click='onRestart'>restart</button>
      <button>load patch</button>
      <input type='file' ref='file' @change='onFileSelect'>
      <button @click='onFlash'>flash</button>
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
import { ESPLoader, Transport, type LoaderOptions, type FlashOptions } from 'esptool-js'
import * as CryptoJS from 'crypto-js'

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

const fileData = ref()

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

const onInspect = () => {

}

// You can use any JavaScript compatible terminal by wrapping it in a helper object like this:
let espLoaderTerminal = {
  clean() {
    // Implement the clean function call for your terminal here.
  },
  writeLine(data) {
    // Implement the writeLine function call for your terminal here.
  },
  write(data) {
    // Implement the write function call for your terminal here.
  },
};

const onFileSelect = (e: Event) => {
  if (!e.target) { return }

  const input = (e.target as HTMLInputElement)

  if (!input) { return }

  const file = (input.files || [])[0]

  if (!file) { return }

  fileData.value = undefined;

  const reader = new FileReader();

  reader.onload = (ev: ProgressEvent<FileReader>) => {
    fileData.value = ev.target?.result;
  };

  reader.readAsBinaryString(file);
}

const onFlash = async () => {
  // if (!port.value) { return }

  const device = await navigator.serial.requestPort({});
  const transport = new Transport(device, true);

  const loaderOptions = {
    transport,
    baudrate: 921600,
    terminal: espLoaderTerminal,
    debugLogging: false,
  } as LoaderOptions;

  const esploader = new ESPLoader(loaderOptions);

  const chip = await esploader.main();

  const flashOptions: FlashOptions = {
    fileArray: [{ data: fileData.value as string, address: 0x10000 }],
    flashSize: "keep",
    eraseAll: false,
    compress: true,
    flashMode: 'DIO',
    flashFreq: '80MHZ',
    reportProgress: (fileIndex, written, total) => {
      console.log(`written ${written} of total ${total}`)
    },
    calculateMD5Hash: (image: string) => CryptoJS.MD5(CryptoJS.enc.Latin1.parse(image)).toString(),
  } as FlashOptions;

  await esploader.writeFlash(flashOptions);

  alert('done')
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
