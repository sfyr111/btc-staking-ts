import {
  script,
  payments,
  Psbt,
  Transaction,
  networks,
  address,
} from "bitcoinjs-lib";
import { Taptree } from "bitcoinjs-lib/src/types";

import { internalPubkey } from "./constants/internalPubkey";
import { initBTCCurve } from "./utils/curve";
import { PK_LENGTH, StakingScriptData } from "./utils/stakingScript";
import { UTXO } from "./types/UTXO";

export { initBTCCurve, StakingScriptData };

// stakingTransaction constructs an unsigned BTC Staking transaction
// - Outputs:
//   - The first one corresponds to the staking script with a certain amount
//   - The second one corresponds to the change from spending the amount and the transaction fee
//   - In case of data embed script, it will be added as the second output, fee as the third
// 构建一个未签名的比特币赌注交易
/**
 * @param timelockScript - 赌注锁定脚本
 * @param unbondingScript - 解绑脚本
 * @param slashingScript - 惩罚脚本
 * @param amount - 赌注金额
 * @param fee - 交易费用
 * @param changeAddress - 找零地址
 * @param inputUTXOs - 输入的未花费交易输出列表
 * @param network - 比特币网络信息
 * @param publicKeyNoCoord - 没有坐标的公钥，用于Taproot btcWallet.isTaproot ? btcWallet.publicKeyNoCoord() : undefined
 * @param dataEmbedScript - 数据嵌入脚本，可选
 * @returns {Psbt} 返回一个部分签名的比特币交易
 *
 *
 * // 使用钱包签名交易
 * const signedStakingTx: Promise<Transaction> = await btcWallet.signTransaction(unsignedStakingTx);
 *
 * // 签名完成后，转换 PSBT 为最终的比特币交易格式
 * const finalTransaction = signedStakingTx.finalizeAllInputs().extractTransaction();
 *
 * // 将最终的交易广播到比特币网络
 * await btcWallet.broadcastTransaction(finalTransaction.toHex());
 *
 * // 可选：打印或记录交易 ID 以便跟踪
 * console.log("Transaction broadcasted with ID:", finalTransaction.getId());
 *
 * // 在实际的代码实现中，可能需要处理异常和错误，确保交易过程的稳定性和安全性
 * try {
 *     const txStatus = await btcWallet.checkTransactionStatus(finalTransaction.getId());
 *     console.log("Transaction status:", txStatus);
 * } catch (error) {
 *     console.error("Error checking transaction status:", error);
 * }
 */
export function stakingTransaction(
  timelockScript: Buffer,
  unbondingScript: Buffer,
  slashingScript: Buffer,
  amount: number,
  fee: number,
  changeAddress: string,
  inputUTXOs: UTXO[],
  network: networks.Network,
  publicKeyNoCoord?: Buffer, // 钱包来源 btcWallet.isTaproot ? btcWallet.publicKeyNoCoord() : undefined
  dataEmbedScript?: Buffer,
): Psbt {
  // Check that amount and fee are bigger than 0
  if (amount <= 0 || fee <= 0) {
    throw new Error("Amount and fee must be bigger than 0");
  }

  // Check whether the change address is a valid Bitcoin address.
  if (!address.toOutputScript(changeAddress, network)) {
    throw new Error("Invalid change address");
  }

  // Check whether the public key is valid
  if (publicKeyNoCoord && publicKeyNoCoord.length !== PK_LENGTH) {
    throw new Error("Invalid public key");
  }

  // Create a partially signed transaction
  const psbt = new Psbt({ network });
  // Add the UTXOs provided as inputs to the transaction
  // 添加提供的UTXOs作为交易的输入
  let inputsSum = 0;
  for (let i = 0; i < inputUTXOs.length; ++i) {
    const input = inputUTXOs[i];
    psbt.addInput({
      hash: input.txid,
      index: input.vout,
      witnessUtxo: {
        script: Buffer.from(input.scriptPubKey, "hex"),
        value: input.value,
      },
      // this is needed only if the wallet is in taproot mode
      // UTXO 必须是个 tr 输出
      ...(publicKeyNoCoord && { tapInternalKey: publicKeyNoCoord }),
    });
    inputsSum += input.value;
  }

  // Check whether inputSum is enough to satisfy the staking amount
  if (inputsSum < amount + fee) {
    throw new Error("Insufficient funds");
  }

  const scriptTree: Taptree = [
    {
      output: slashingScript,
    },
    [{ output: unbondingScript }, { output: timelockScript }],
  ];

  // Create an pay-2-taproot (p2tr) output using the staking script
  const stakingOutput = payments.p2tr({
    internalPubkey, // 由此公钥创建 p2tr payment
    scriptTree,
    network,
  });

  // Add the staking output to the transaction
  psbt.addOutput({
    address: stakingOutput.address!,
    value: amount,
  });

  if (dataEmbedScript) {
    // Add the data embed output to the transaction
    psbt.addOutput({
      script: dataEmbedScript, // OP_RETURN
      value: 0,
    });
  }

  // Add a change output only if there's any amount leftover from the inputs
  if (inputsSum > amount + fee) {
    psbt.addOutput({
      address: changeAddress,
      value: inputsSum - (amount + fee),
    });
  }

  return psbt;
}

// Delegation is manually unbonded
// 手动早期解绑赌注交易构建函数
export function withdrawEarlyUnbondedTransaction(
  unbondingTimelockScript: Buffer,  // 解绑时锁定脚本
  slashingScript: Buffer,           // 惩罚脚本
  tx: Transaction,                  // 原赌注交易
  withdrawalAddress: string,        // 提款地址
  withdrawalFee: number,            // 提款手续费
  network: networks.Network,        // 比特币网络
  outputIndex: number = 0,          // 赌注输出的索引，默认为0
): Psbt {
  // 构建脚本树，包括惩罚脚本和解绑时锁定脚本
  const scriptTree: Taptree = [
    {
      output: slashingScript,
    },
    { output: unbondingTimelockScript },
  ];
  // 调用通用提款交易构建函数
  return withdrawalTransaction(
    unbondingTimelockScript,
    scriptTree,
    tx,
    withdrawalAddress,
    withdrawalFee,
    network,
    outputIndex,
  );
}

// Delegation is naturally unbonded
// 自然解绑赌注交易构建函数
export function withdrawTimelockUnbondedTransaction(
  timelockScript: Buffer,           // 时间锁脚本
  slashingScript: Buffer,           // 惩罚脚本
  unbondingScript: Buffer,          // 解绑脚本
  tx: Transaction,                  // 原赌注交易
  withdrawalAddress: string,        // 提款地址
  withdrawalFee: number,            // 提款手续费
  network: networks.Network,        // 比特币网络
  outputIndex: number = 0,          // 赌注输出的索引，默认为0
): Psbt {
  // 构建脚本树，包括惩罚脚本、解绑脚本和时间锁脚本
  const scriptTree: Taptree = [
    {
      output: slashingScript,
    },
    [{ output: unbondingScript }, { output: timelockScript }],
  ];
  // 调用通用提款交易构建函数
  return withdrawalTransaction(
    timelockScript,
    scriptTree,
    tx,
    withdrawalAddress,
    withdrawalFee,
    network,
    outputIndex,
  );
}

// withdrawalTransaction generates a transaction that
// spends the staking output of the staking transaction
// 构建一个赌注提款交易，用于赌注的提取
export function withdrawalTransaction(
  timelockScript: Buffer,           // 使用的时间锁脚本
  scriptTree: Taptree,              // 脚本树定义
  tx: Transaction,                  // 原赌注交易
  withdrawalAddress: string,        // 提款地址
  withdrawalFee: number,            // 提款手续费
  network: networks.Network,        // 比特币网络
  outputIndex: number = 0,          // 赌注输出的索引
): Psbt {
  // Check that withdrawal fee is bigger than 0
  if (withdrawalFee <= 0) {
    throw new Error("Withdrawal fee must be bigger than 0");
  }

  // Check that outputIndex is bigger or equal to 0
  if (outputIndex < 0) {
    throw new Error("Output index must be bigger or equal to 0");
  }

  // position of time in the timelock script
  const timePosition = 2;
  const decompiled = script.decompile(timelockScript);
  // script.decompile(timelockScript): 这行代码将 timelockScript（一般为编译后的二进制格式）解码为更易读的形式（即从脚本的序列化格式解码为其组成部分）。解码后的脚本通常为一个操作码和数据元素的数组。

  if (!decompiled) {
    throw new Error("Timelock script is not valid");
  }

  let timelock = 0;

  // if the timelock is a buffer, it means it's a number bigger than 16 blocks
  // 解析时间锁值，根据具体存储格式进行处理
  if (typeof decompiled[timePosition] !== "number") {
    const timeBuffer = decompiled[timePosition] as Buffer;
    timelock = script.number.decode(timeBuffer);
    // script.number.decode(timeBuffer): 这个函数用于解码脚本中编码的数字，timeBuffer 通常包含特定的时间锁定值（如相对时间或绝对时间），这是检查交易能否被花费的一个条件。
  } else {
    // in case timelock is <= 16 it will be a number, not a buffer
    const wrap = decompiled[timePosition] % 16;
    timelock = wrap === 0 ? 16 : wrap;
  }

  // output: 指定用于赎回的脚本，这里是 timelockScript，这通常包含一些如时间锁定条件的脚本逻辑，这些脚本决定了在什么条件下这些币可以被进一步花费。
  // redeemVersion: 赎回脚本的版本，这里是 192，根据BIP 342，这个值是用于Tapscript的版本号，指示了如何解析和执行 output 脚本。
  const redeem = {
    output: timelockScript,
    redeemVersion: 192,
  };
  // 创建P2TR支付结构，包括内部公钥和脚本树
  const p2tr = payments.p2tr({
    internalPubkey,
    scriptTree,
    redeem,
    network,
  });
  // 定义如何花费这些币的脚本（scriptPubKey）
  const tapLeafScript = {
    leafVersion: redeem.redeemVersion, // // BIP342 leaf version for Tapscript
    script: redeem.output, // 实际执行的Tapscript
    controlBlock: p2tr.witness![p2tr.witness!.length - 1], // 控制块，包含Merkle根和其他必要的数据，用于证明脚本路径的有效性。
  };

  const psbt = new Psbt({ network });

  // only transactions with version 2 can trigger OP_CHECKSEQUENCEVERIFY
  // https://github.com/btcsuite/btcd/blob/master/txscript/opcode.go#L1174
  // 构建PSBT对象，设置版本和输入输出参数
  psbt.setVersion(2);
  // 添加输入，设置时间锁和提款信息
  psbt.addInput({
    hash: tx.getHash(),
    index: outputIndex,
    tapInternalKey: internalPubkey,
    witnessUtxo: { // witnessUtxo 是隔离见证（SegWit）交易中使用的一个字段，包含了UTXO的详细信息
      value: tx.outs[outputIndex].value, // UTXO中包含的比特币数量。
      script: tx.outs[outputIndex].script, // 定义如何花费这些币的脚本（scriptPubKey）
    },
    tapLeafScript: [tapLeafScript],
    sequence: timelock,
  });
  // 添加提款输出，扣除手续费后的余额发往提款地址
  psbt.addOutput({
    address: withdrawalAddress,
    value: tx.outs[outputIndex].value - withdrawalFee,
  });

  return psbt;
}

// slashingTransaction generates a transaction that
// spends the staking output of the staking transaction
// Outputs:
//   - The first one sends input * slashing_rate funds to the slashing address
//   - The second one sends input * (1-slashing_rate) - fee funds back to the user’s address
// 生成一个用于执行赌注惩罚的交易
export function slashingTransaction(
  scriptTree: Taptree,          // 脚本树定义，用于指定交易验证的逻辑
  redeemOutput: Buffer,         // 赎回输出，即参与赌注惩罚的脚本
  transaction: Transaction,     // 原赌注交易
  slashingAddress: string,      // 惩罚资金接收地址
  slashingRate: number,         // 惩罚比例，定义了有多少比例的赌注资金将被扣除
  changeScript: Buffer,         // 找零脚本，用于退回给用户的剩余资金
  minimumFee: number,           // 交易最小手续费
  network: networks.Network,    // 比特币网络定义
  outputIndex: number = 0,      // 赌注输出的索引，默认为0
): Psbt {
  // Check that slashing rate and minimum fee are bigger than 0
  if (slashingRate <= 0 || minimumFee <= 0) {
    throw new Error("Slashing rate and minimum fee must be bigger than 0");
  }

  // Check that outputIndex is bigger or equal to 0
  if (outputIndex < 0) {
    throw new Error("Output index must be bigger or equal to 0");
  }

  const redeem = {
    output: redeemOutput,
    redeemVersion: 192,
  };

  const p2tr = payments.p2tr({
    internalPubkey,
    scriptTree,
    redeem,
    network,
  });

  const tapLeafScript = {
    leafVersion: redeem.redeemVersion,
    script: redeem.output,
    controlBlock: p2tr.witness![p2tr.witness!.length - 1],
  };

  const psbt = new Psbt({ network });
  psbt.addInput({
    hash: transaction.getHash(),  // 赌注交易哈希
    index: outputIndex,           // 赌注输出索引
    tapInternalKey: internalPubkey,  // Taproot内部公钥
    witnessUtxo: {                // witness UTXO配置
      value: transaction.outs[0].value,
      script: transaction.outs[0].script,
    },
    tapLeafScript: [tapLeafScript],  // 使用Tapleaf脚本配置
  });

  // 计算用户剩余资金
  const userValue = transaction.outs[0].value * (1 - slashingRate) - minimumFee;

  // We need to verify that this is above 0
  if (userValue <= 0) {
    // If it is not, then an error is thrown and the user has to stake more
    throw new Error("Not enough funds to slash, stake more");
  }

  // 添加惩罚输出
  psbt.addOutput({
    address: slashingAddress,
    value: transaction.outs[0].value * slashingRate,
  });

  // Change output contains unbonding timelock script
  // 计算并添加找零输出，其中包含未赌注时锁脚本
  const changeOutput = payments.p2tr({
    internalPubkey,
    scriptTree: { output: changeScript },
    network,
  });

  // Add the change output
  psbt.addOutput({
    address: changeOutput.address!,
    value: transaction.outs[0].value * (1 - slashingRate) - minimumFee,
  });

  return psbt;
}

// 创建一个解绑交易，允许从赌注交易中提取资金
export function unbondingTransaction(
  unbondingScript: Buffer,          // 解绑脚本
  unbondingTimelockScript: Buffer,  // 解绑时锁脚本
  timelockScript: Buffer,           // 时间锁脚本
  slashingScript: Buffer,           // 惩罚脚本
  stakingTx: Transaction,           // 原赌注交易
  transactionFee: number,           // 交易手续费
  network: networks.Network,        // 比特币网络定义
  outputIndex: number = 0           // 赌注输出的索引，默认为0
): Psbt {
  // Check that transaction fee is bigger than 0
  if (transactionFee <= 0) {
    throw new Error("Unbonding fee must be bigger than 0");
  }

  // Check that outputIndex is bigger or equal to 0
  if (outputIndex < 0) {
    throw new Error("Output index must be bigger or equal to 0");
  }

  // Build input tapleaf script
  // 构建输入脚本树，定义如何验证交易
  const inputScriptTree: Taptree = [
    {
      output: slashingScript,
    },
    [{ output: unbondingScript }, { output: timelockScript }],
  ];

  // 设置输入的赎回脚本
  const inputRedeem = {
    output: unbondingScript,
    redeemVersion: 192,
  };

  // 创建P2TR支付结构，用于解绑操作
  const p2tr = payments.p2tr({
    internalPubkey,
    scriptTree: inputScriptTree,
    redeem: inputRedeem,
    network,
  });

  // 定义输入的Tapleaf脚本
  const inputTapLeafScript = {
    leafVersion: inputRedeem.redeemVersion,
    script: inputRedeem.output,
    controlBlock: p2tr.witness![p2tr.witness!.length - 1],
  };

  const psbt = new Psbt({ network });
  // 添加输入，包含原赌注交易的哈希和索引
  psbt.addInput({
    hash: stakingTx.getHash(),
    index: outputIndex,
    tapInternalKey: internalPubkey,
    witnessUtxo: {
      value: stakingTx.outs[0].value,
      script: stakingTx.outs[0].script,
    },
    tapLeafScript: [inputTapLeafScript],
  });

  // Build output tapleaf script
  // 构建输出脚本树，用于未来可能的解绑操作
  const outputScriptTree: Taptree = [
    {
      output: slashingScript,
    },
    { output: unbondingTimelockScript },
  ];
  // 配置未绑定输出的P2TR支付
  const unbondingOutput = payments.p2tr({
    internalPubkey,
    scriptTree: outputScriptTree,
    network,
  });

  // Add the unbonding output
  // 添加解绑输出，扣除手续费后将余额返回
  psbt.addOutput({
    address: unbondingOutput.address!,
    value: stakingTx.outs[0].value - transactionFee,
  });

  return psbt;
}

// this function is used to create witness for unbonding transaction
// 用于为解绑交易创建见证数据的函数
export const createWitness = (
  originalWitness: Buffer[],          // 原始见证数据
  paramsCovenants: Buffer[],          // 契约参数，可能包括一些特定条件或脚本
  covenantSigs: {
    btc_pk_hex: string;               // 契约签名所用的比特币公钥，以十六进制字符串形式
    sig_hex: string;                  // 签名本身，以十六进制字符串形式
  }[],
) => {
  // map API response to Buffer values
  // 将API响应的十六进制字符串映射转换为Buffer对象
  const covenantSigsBuffers = covenantSigs.map((sig) => ({
    btc_pk_hex: Buffer.from(sig.btc_pk_hex, "hex"),
    sig_hex: Buffer.from(sig.sig_hex, "hex"),
  }));
  // we need covenant from params to be sorted in reverse order
  // 将契约参数按照Buffer比较结果进行排序，并反转顺序
  const paramsCovenantsSorted = [...paramsCovenants]
    .sort(Buffer.compare)
    .reverse();
  // 构建组合契约签名数据
  const composedCovenantSigs = paramsCovenantsSorted.map((covenant) => {
    // in case there's covenant with this btc_pk_hex we return the sig
    // otherwise we return empty Buffer
    // 如果存在对应的契约签名，则返回签名；否则返回空的Buffer
    const covenantSig = covenantSigsBuffers.find(
      (sig) => sig.btc_pk_hex.compare(covenant) === 0,
    );
    return covenantSig?.sig_hex || Buffer.alloc(0);
  });
  // 将组合的契约签名与原始见证数据合并，形成完整的见证数据
  return [...composedCovenantSigs, ...originalWitness];
};
