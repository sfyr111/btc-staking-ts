// internalPubkey 是一个指定的不可花费的内部公钥，用于taproot输出
const key =
  "0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

// 导出 internalPubkey，处理后供外部模块使用
export const internalPubkey = Buffer.from(key, "hex").subarray(1, 33);
// 1. 使用 Buffer.from(key, "hex") 将十六进制的字符串转换成二进制缓冲区。
// 2. 使用 subarray(1, 33) 从缓冲区中截取从第1位到第33位的部分，这是因为在taproot中，
//    第一个字节通常是用来指示压缩公钥的，而剩下的32字节则是公钥坐标。在这个案例中，
//    我们只需要公钥坐标部分。

console.log(internalPubkey)
// <Buffer 50 92 9b 74 c1 a0 49 54 b7 8b 4b 60 35 e9 7a 5e 07 8a 5a 0f 28 ec 96 d5 47 bf ee 9a ce 80 3a c0>
