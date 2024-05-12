// 导入来自 "bitcoinjs-lib" 的 initEccLib 函数。
import { initEccLib } from "bitcoinjs-lib";

// 从 "@bitcoin-js/tiny-secp256k1-asmjs" 模块导入所有内容，并赋给变量 ecc。
import * as ecc from "@bitcoin-js/tiny-secp256k1-asmjs";

// 定义一个名为 initBTCCurve 的函数，用于初始化椭圆曲线加密库。
export function initBTCCurve() {
  // 调用 initEccLib 函数，并将之前导入的 ecc 模块作为参数传递。
  // 这个操作将使得 bitcoinjs-lib 使用 tiny-secp256k1-asmjs 提供的加密算法实现。
  initEccLib(ecc);
}
