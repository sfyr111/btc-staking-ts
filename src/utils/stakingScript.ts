import { script, opcodes } from "bitcoinjs-lib";

import { StakingScripts } from "../types/StakingScripts";

// PK_LENGTH denotes the length of a public key in bytes
export const PK_LENGTH = 32;

// StakingScriptData 是一个类，用于保存BTC赌注脚本所需的数据
// 并暴露方法将其转换为有用的格式
export class StakingScriptData {
  #stakerKey: Buffer;
  #finalityProviderKeys: Buffer[];
  #covenantKeys: Buffer[];
  #covenantThreshold: number;
  #stakingTimeLock: number;
  #unbondingTimeLock: number;
  #magicBytes: Buffer;

  constructor(
    // The `stakerKey` is the public key of the staker without the coordinate bytes.
    stakerKey: Buffer,  // 赌注者的公钥
    // A list of public keys without the coordinate bytes corresponding to the finality providers
    // the stake will be delegated to.
    // Currently, Babylon does not support restaking, so this should contain only a single item.
    finalityProviderKeys: Buffer[], // 最终确认者的公钥列表
    // A list of the public keys without the coordinate bytes corresponding to
    // the covenant emulators.
    // This is a parameter of the Babylon system and should be retrieved from there.
    covenantKeys: Buffer[],// 契约密钥的公钥列表
    // The number of covenant emulator signatures required for a transaction
    // to be valid.
    // This is a parameter of the Babylon system and should be retrieved from there.
    covenantThreshold: number,  // 有效交易所需的契约签名数量
    // The staking period denoted as a number of BTC blocks.
    stakingTimelock: number, // 赌注的锁定期，以BTC区块数计
    // The unbonding period denoted as a number of BTC blocks.
    // This value should be more than equal than the minimum unbonding time of the
    // Babylon system.
    unbondingTimelock: number, // 解绑期，以BTC区块数计
    // The magic bytes used to identify the staking transaction on Babylon
    // through the data return script
    magicBytes: Buffer, // 用于在Babylon通过数据返回脚本标识赌注交易的魔法字节
  ) {
    // Check that required input values are not missing when creating an instance of the StakingScriptData class
    if (
      !stakerKey ||
      !finalityProviderKeys ||
      !covenantKeys ||
      !covenantThreshold ||
      !stakingTimelock ||
      !unbondingTimelock ||
      !magicBytes
    ) {
      throw new Error("Missing required input values");
    }
    this.#stakerKey = stakerKey;
    this.#finalityProviderKeys = finalityProviderKeys;
    this.#covenantKeys = covenantKeys;
    this.#covenantThreshold = covenantThreshold;
    this.#stakingTimeLock = stakingTimelock;
    this.#unbondingTimeLock = unbondingTimelock;
    this.#magicBytes = magicBytes;

    // Run the validate method to check if the provided script data is valid
    if (!this.validate()) {
      throw new Error("Invalid script data provided");
    }
  }

  /**
   * Validates the staking script.
   * @returns {boolean} Returns true if the staking script is valid, otherwise false.
   */
  validate(): boolean {
    // check that staker key is the correct length
    // 验证赌注者公钥的长度是否正确
    if (this.#stakerKey.length != PK_LENGTH) {
      return false;
    }
    // check that finalityProvider keys are the correct length
    // 验证最终确认者公钥列表中每个公钥的长度是否正确
    if (
      this.#finalityProviderKeys.some(
        (finalityProviderKey) => finalityProviderKey.length != PK_LENGTH,
      )
    ) {
      return false;
    }
    // check that covenant keys are the correct length
    // 验证契约公钥列表中每个公钥的长度是否正确
    if (
      this.#covenantKeys.some((covenantKey) => covenantKey.length != PK_LENGTH)
    ) {
      return false;
    }
    // check that maximum value for staking time is not greater than uint16
    // 验证锁定时间的最大值是否超过uint16的限制 todo
    if (this.#stakingTimeLock > 65535) {
      return false;
    }
    return true;
  }

  // The staking script allows for multiple finality provider public keys
  // to support (re)stake to multiple finality providers
  // Covenant members are going to have multiple keys

  // 构建一个时间锁定脚本
  /**
   * @param timelock - 时间锁定值，表示在这么多区块之后，资金才能被使用。
   * @returns {Buffer} 返回包含编译后的时间锁定脚本的缓冲区。
   */
  buildTimelockScript(timelock: number): Buffer {
    // 使用bitcoinjs-lib的script模块来编译一个脚本数组
    return script.compile([
      this.#stakerKey,             // 赌注者的公钥
      opcodes.OP_CHECKSIGVERIFY,   // 验证签名，如果签名不正确，则脚本执行失败
      script.number.encode(timelock),  // 将时间锁定值编码为脚本数字
      opcodes.OP_CHECKSEQUENCEVERIFY, // 检查序列号，确保交易至少等待了指定的区块数
    ]);
  }


  /**
   * 构建赌注时间锁脚本。
   * 只有给定公钥的私钥持有者在相对锁定时间之后才能花费资金。
   * 生成的时间锁脚本格式为：
   *    <stakerPubKey>               // 赌注者的公钥
   *    OP_CHECKSIGVERIFY            // 验证签名，如果签名不正确，则脚本执行失败
   *    <stakingTimeBlocks>          // 赌注的锁定区块数
   *    OP_CHECKSEQUENCEVERIFY       // 检查序列号，确保交易至少等待了指定的区块数
   * @returns {Buffer} 返回赌注时间锁脚本。
   */
  buildStakingTimelockScript(): Buffer {
    // 调用 buildTimelockScript 方法，传入赌注的锁定区块数
    return this.buildTimelockScript(this.#stakingTimeLock);
  }

  /**
   /**
   * 构建解绑时间锁脚本。
   * 生成的解绑时间锁脚本格式为：
   *    <stakerPubKey>               // 赌注者的公钥
   *    OP_CHECKSIGVERIFY            // 验证签名，如果签名不正确，则脚本执行失败
   *    <unbondingTimeBlocks>        // 解绑的锁定区块数
   *    OP_CHECKSEQUENCEVERIFY       // 检查序列号，确保交易至少等待了指定的区块数
   * @returns {Buffer} 返回解绑时间锁脚本。
   */
  buildUnbondingTimelockScript(): Buffer {
    // 调用 buildTimelockScript 方法，传入解绑的锁定区块数
    return this.buildTimelockScript(this.#unbondingTimeLock);
  }

  /**
   * Builds the unbonding script in the form:
   *    buildSingleKeyScript(stakerPk, true) ||
   *    buildMultiKeyScript(covenantPks, covenantThreshold, false)
   *    || means combining the scripts
   * @returns {Buffer} The unbonding script.
   */
  /**
   * 构建解绑脚本。
   * 脚本结合了单公钥验证和多公钥验证脚本：
   * - 单公钥脚本验证赌注者的公钥。
   * - 多公钥脚本验证多个契约成员的公钥。
   * || 表示脚本的组合。
   * @returns {Buffer} 返回解绑脚本的缓冲区。
   */
  buildUnbondingScript(): Buffer {
    return Buffer.concat([
      // this.#buildSingleKeyScript(this.#stakerKey, true): 创建一个单公钥脚本，用于验证赌注者的公钥，确保只有公钥持有者可以执行解绑操作。
      this.#buildSingleKeyScript(this.#stakerKey, true),
      // this.#buildMultiKeyScript(this.#covenantKeys, this.#covenantThreshold, false): 创建一个多公钥脚本，用于验证契约成员的公钥，需要达到指定的阈值（this.#covenantThreshold），但不需要执行验证后的停止（由 false 参数指定）。
      this.#buildMultiKeyScript(
        this.#covenantKeys,
        this.#covenantThreshold,
        false,
      ),
    ]);
  }

  /**
   * Builds the slashing script for staking in the form:
   *    buildSingleKeyScript(stakerPk, true) ||
   *    buildMultiKeyScript(finalityProviderPKs, 1, true) ||
   *    buildMultiKeyScript(covenantPks, covenantThreshold, false)
   *    || means combining the scripts
   * The slashing script is a combination of single-key and multi-key scripts.
   * The single-key script is used for staker key verification.
   * The multi-key script is used for finality provider key verification and covenant key verification.
   * @returns {Buffer} The slashing script as a Buffer.
   */
  /**
   * 构建惩罚脚本。
   * 脚本结合了单公钥和多公钥脚本，用于验证赌注者的公钥和最终确认者的公钥：
   * - 单公钥脚本用于赌注者公钥验证。
   * - 第一个多公钥脚本用于验证最终确认者的公钥，阈值设置为1，表示只需一个确认者的签名即可执行惩罚。
   * - 第二个多公钥脚本用于验证契约成员的公钥。
   * || 表示脚本的组合。
   * @returns {Buffer} 返回惩罚脚本的缓冲区。
   */
  buildSlashingScript(): Buffer {
    return Buffer.concat([
      this.#buildSingleKeyScript(this.#stakerKey, true),
      // 用于验证最终确认者的公钥，只需要一个签名即可执行惩罚。
      this.#buildMultiKeyScript(
        this.#finalityProviderKeys,
        // The threshold is always 1 as we only need one
        // finalityProvider signature to perform slashing
        // (only one finalityProvider performs an offence)
        // 只需要一个最终确认者的签名
        1,
        // OP_VERIFY/OP_CHECKSIGVERIFY is added at the end
        // 包含验证后停止执行的操作码
        true,
      ),
      // 用于验证契约成员的公钥，但不包含停止执行的验证。
      this.#buildMultiKeyScript(
        this.#covenantKeys,
        this.#covenantThreshold,
        // No need to add verify since covenants are at the end of the script
        // 末尾的多签名脚本不需要停止执行的验证
        false,
      ),
    ]);
  }

  /**
   * Builds a data embed script for staking in the form:
   *    OP_RETURN || <serializedStakingData>
   * where serializedStakingData is the concatenation of:
   *    MagicBytes || Version || StakerPublicKey || FinalityProviderPublicKey || StakingTimeLock
   * @returns {Buffer} The compiled data embed script.
   */
  /**
   * 构建用于赌注的数据嵌入脚本。
   * 脚本格式为 OP_RETURN 后跟序列化的赌注数据。
   * 其中，序列化的赌注数据包括：
   *    魔术字节 || 版本号 || 赌注者公钥 || 最终确认者公钥 || 赌注时间锁
   * @returns {Buffer} 返回编译后的数据嵌入脚本。
   * 使用 OP_RETURN 确保了这些数据是以一种不可花费的方式存储的，仅用于记录和验证目的，而不影响链上的货币流动。
   */
  buildDataEmbedScript(): Buffer {
    // 分配1字节空间用于版本号，并写入版本号（此处为0）
    const version = Buffer.alloc(1); // 创建一个大小为1字节的Buffer
    version.writeUInt8(0); // 将版本号0写入Buffer（使用UInt8表示无符号8位整数）

    // 分配2字节空间用于赌注时间锁，并以大端格式写入赌注时间锁
    const stakingTimeLock = Buffer.alloc(2); // 创建一个大小为2字节的Buffer
    stakingTimeLock.writeUInt16BE(this.#stakingTimeLock); // 将赌注时间锁的值写入Buffer（使用UInt16BE表示无符号16位整数，大端字节顺序）

    // 将各个部分的数据合并为一个序列化的数据Buffer
    const serializedStakingData = Buffer.concat([
      this.#magicBytes,          // 魔术字节
      version,                   // 版本号
      this.#stakerKey,           // 赌注者公钥
      this.#finalityProviderKeys[0], // 最终确认者的第一个公钥
      stakingTimeLock            // 赌注时间锁
    ]);

    // 使用script.compile将OP_RETURN操作码和序列化数据合并成最终的脚本
    return script.compile([
      opcodes.OP_RETURN,         // OP_RETURN操作码，标记数据为不可花费
      serializedStakingData      // 后续的序列化赌注数据
    ]);
  }

  /**
   * Builds the staking scripts.
   * @returns {StakingScripts} The staking scripts.
   * 支持赌注的创建、解锁、惩罚处理、赌注时间锁定以及数据记录
   */
  buildScripts(): StakingScripts {
    return {
      // 构建赌注时间锁脚本，确保只有在指定时间之后，持有者才能操作这些资金。
      timelockScript: this.buildStakingTimelockScript(),

      // 构建解绑脚本，用于处理资金的解锁过程，可能涉及多重签名验证。
      unbondingScript: this.buildUnbondingScript(),

      // 构建惩罚脚本，用于在违规行为发生时启动惩罚机制，这通常需要特定的签名来执行。
      slashingScript: this.buildSlashingScript(),

      // 构建另一个解绑时间锁脚本，这可能与unbondingScript有所不同，专注于处理不同类型的赌注解锁情况。
      unbondingTimelockScript: this.buildUnbondingTimelockScript(),

      // 构建数据嵌入脚本，用于将赌注相关数据记录在区块链上，以 `OP_RETURN` 的形式保证这些数据是不可花费的。
      dataEmbedScript: this.buildDataEmbedScript(),
    };
  }

  // buildSingleKeyScript and buildMultiKeyScript allow us to reuse functionality
  // for creating Bitcoin scripts for the unbonding script and the slashing script

  /**
   * 保只有公钥的合法持有者才能操作资金
   * 构建单个公钥脚本。
   * 根据参数 withVerify 的值，创建不同的脚本：
   *    <pk> OP_CHECKSIGVERIFY // 如果 withVerify 为 true
   *    <pk> OP_CHECKSIG       // 如果 withVerify 为 false
   * @param pk - 公钥的缓冲区。
   * @param withVerify - 布尔值，指示是否包含 OP_CHECKSIGVERIFY 操作码。
   * @returns 编译后的脚本缓冲区。
   */
  #buildSingleKeyScript(pk: Buffer, withVerify: boolean): Buffer {
    // 检查公钥长度是否正确
    if (pk.length != PK_LENGTH) {
      throw new Error("Invalid key length");  // 如果长度不正确，抛出错误
    }
    // 使用 script.compile 编译一个脚本数组
    return script.compile([
      pk,  // 公钥
      withVerify ? opcodes.OP_CHECKSIGVERIFY : opcodes.OP_CHECKSIG,
      // 根据 withVerify 的值选择添加 OP_CHECKSIGVERIFY 或 OP_CHECKSIG
      // OP_CHECKSIGVERIFY 会在验证签名后继续执行脚本，而 OP_CHECKSIG 则会在验证签名后停止执行脚本。
    ]);
  }


  /**
   * 构建多公钥脚本。
   *    <pk1> OP_CHEKCSIG <pk2> OP_CHECKSIGADD <pk3> OP_CHECKSIGADD ... <pkN> OP_CHECKSIGADD <threshold> OP_NUMEQUAL
   *      <withVerify -> OP_NUMEQUALVERIFY>
   *    如果 withVerify 为真，则添加 OP_NUMEQUALVERIFY
   * 脚本验证提供的公钥是否唯一，并且阈值不大于公钥数量。
   * 如果只提供了一个公钥，将返回单公钥签名脚本。
   * @param pks - 公钥数组。
   * @param threshold - 需要的有效签名者数量。
   * @param withVerify - 布尔值，指示是否包括 OP_VERIFY 操作码。
   * @returns 编译后的多公钥脚本作为缓冲区。
   * @throws {Error} 如果没有提供公钥，所需有效签名者数量超过提供的公钥数量，或提供了重复的公钥。
   */
  #buildMultiKeyScript(
    pks: Buffer[],
    threshold: number,
    withVerify: boolean,
  ): Buffer {
    // 验证公钥数组是否为空
    if (!pks || pks.length === 0) {
      throw new Error("No keys provided");
    }
    // 检查所有公钥长度是否正确
    if (pks.some((pk) => pk.length != PK_LENGTH)) {
      throw new Error("Invalid key length");
    }
    // 验证阈值是否小于等于公钥数量
    if (threshold > pks.length) {
      throw new Error("Required number of valid signers is greater than number of provided keys");
    }
    // 如果只提供了一个公钥，返回单公钥脚本
    if (pks.length === 1) {
      return this.#buildSingleKeyScript(pks[0], withVerify);
    }
    // 对公钥进行排序
    // 目的：对公钥数组进行排序是为了后续能够更有效地检查是否有重复的公钥，并确保脚本的一致性和预测性。
    // 方法：使用 Buffer.compare 方法，它可以按字典顺序比较两个 Buffer 对象，从而对公钥进行排序。
    const sortedPks = pks.sort(Buffer.compare);
    // 验证公钥是否有重复
    // 目的：检查排序后的公钥数组中是否有连续的重复元素，确保所有公钥都是唯一的。
    // 方法：遍历排序后的公钥数组，使用 equals 方法比较相邻的公钥是否相同。如果发现重复，则抛出错误，因为每个公钥应当是独一无二的。
    for (let i = 0; i < sortedPks.length - 1; ++i) {
      if (sortedPks[i].equals(sortedPks[i + 1])) {
        throw new Error("Duplicate keys provided");
      }
    }
    // 构建脚本元素数组
    // 目的：构建一个执行多重签名验证的脚本，开始于第一个公钥和 OP_CHECKSIG，随后每个公钥后都跟随一个 OP_CHECKSIGADD。
    // 脚本作用：
    // OP_CHECKSIG：验证第一个公钥的签名是否正确。
    // OP_CHECKSIGADD：对后续的公钥，同样验证签名，并将之前的验证结果与当前结果相加。
    const scriptElements = [sortedPks[0], opcodes.OP_CHECKSIG];
    for (let i = 1; i < sortedPks.length; i++) {
      scriptElements.push(sortedPks[i]);
      scriptElements.push(opcodes.OP_CHECKSIGADD);
    }

    // encode 接受一个常规的数字。
    // 将该数字转换成比特币脚本中使用的小端可变长度格式。
    // 输出一个 Buffer 或类似的字节序列，这个序列可以直接被比特币脚本引擎理解和处理。
    scriptElements.push(script.number.encode(threshold));
    // 添加阈值和验证条件
    // 目的：设置必须达到的有效签名数量，并根据 withVerify 决定是否在验证通过后继续执行脚本。
    // 脚本作用：
    // OP_NUMEQUAL：比较栈顶两个值是否相等（即有效签名总数是否达到阈值）。
    // OP_NUMEQUALVERIFY：与 OP_NUMEQUAL 类似，但如果结果为真，则继续执行脚本；如果为假，则停止执行并报错。
    if (withVerify) {
      scriptElements.push(opcodes.OP_NUMEQUALVERIFY);
    } else {
      scriptElements.push(opcodes.OP_NUMEQUAL);
    }
    // 编译脚本元素为最终的脚本缓冲区
    // 目的：将构建的脚本元素数组编译成一个执行脚本，这个脚本将用于验证比特币交易中的多重签名条件。
    // 方法：使用 script.compile 将脚本元素编译成一个可执行的脚本缓冲区，这个缓冲区将被包含在比特币交易中，用于执行多重签名验证。
    return script.compile(scriptElements);
  }
}
