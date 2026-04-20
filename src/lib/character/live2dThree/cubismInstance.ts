"use client";

import { CubismUserModel } from "@/vendor/cubism-framework/model/cubismusermodel";
import { CubismFramework } from "@/vendor/cubism-framework/live2dcubismframework";
import { CubismDefaultParameterId } from "@/vendor/cubism-framework/cubismdefaultparameterid";
import type { ICubismModelSetting } from "@/vendor/cubism-framework/icubismmodelsetting";
import type { CubismIdHandle } from "@/vendor/cubism-framework/id/cubismid";
import { CubismEyeBlink } from "@/vendor/cubism-framework/effect/cubismeyeblink";
import {
  BreathParameterData,
  CubismBreath,
} from "@/vendor/cubism-framework/effect/cubismbreath";
import { CubismExpressionMotion } from "@/vendor/cubism-framework/motion/cubismexpressionmotion";
import { CubismMatrix44 } from "@/vendor/cubism-framework/math/cubismmatrix44";
import type { ACubismMotion } from "@/vendor/cubism-framework/motion/acubismmotion";
import type { FileMap } from "@/lib/file-map";
import {
  fetchArrayBuffer,
  loadModelSetting,
} from "./cubismSetting";
import { ensureCubismFrameworkReady } from "./cubismRuntime";

const PRIORITY_NORMAL = 2;

export interface MotionDefinitionInfo {
  groupName: string;
  motionCount: number;
}

export interface ExpressionDefinitionInfo {
  name: string;
}

/**
 * 1 体分の Live2D モデルを表す。
 * CubismUserModel を継承して motion / expression / physics / 描画用レンダラを保持する。
 */
export class CubismInstance extends CubismUserModel {
  private _setting: ICubismModelSetting | null = null;
  private _modelHomeDir = "";
  private _textures: WebGLTexture[] = [];
  private _motions = new Map<string, ACubismMotion>();
  private _expressions = new Map<string, ACubismMotion>();
  private _canvasWidth = 0;
  private _canvasHeight = 0;
  private _gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;

  /**
   * fileMap または URL 基準でモデルをロードする。
   * 完了時に moc3, textures, motions, expressions, physics, pose, userdata が全部読み込まれた状態になる。
   */
  public async loadFromSource(
    modelUrl: string,
    fileMap: FileMap | null
  ): Promise<void> {
    await ensureCubismFrameworkReady();

    const { setting, resolveAsset } = await loadModelSetting(modelUrl, fileMap);
    this._setting = setting;
    this._modelHomeDir = ""; // パスは resolveAsset 経由で引く

    // --- moc3
    const mocName = setting.getModelFileName();
    const mocUrl = resolveAsset(mocName);
    if (!mocUrl) {
      throw new Error(`moc3 ファイルを解決できません: ${mocName}`);
    }
    const mocBuffer = await fetchArrayBuffer(mocUrl);
    this.loadModel(mocBuffer, false);
    if (!this._model) {
      throw new Error("moc3 のロードに失敗");
    }
    this._canvasWidth = this._model.getCanvasWidth();
    this._canvasHeight = this._model.getCanvasHeight();

    // --- expressions
    const expCount = setting.getExpressionCount();
    for (let i = 0; i < expCount; i++) {
      const name = setting.getExpressionName(i);
      const file = setting.getExpressionFileName(i);
      const url = resolveAsset(file);
      if (!url) continue;
      const buf = await fetchArrayBuffer(url);
      const exp = CubismExpressionMotion.create(buf, buf.byteLength);
      if (exp) {
        this._expressions.set(name, exp);
      }
    }

    // --- physics
    const physicsName = setting.getPhysicsFileName();
    if (physicsName) {
      const url = resolveAsset(physicsName);
      if (url) {
        const buf = await fetchArrayBuffer(url);
        this.loadPhysics(buf, buf.byteLength);
      }
    }

    // --- pose
    const poseName = setting.getPoseFileName();
    if (poseName) {
      const url = resolveAsset(poseName);
      if (url) {
        const buf = await fetchArrayBuffer(url);
        this.loadPose(buf, buf.byteLength);
      }
    }

    // --- eye blink
    if (setting.getEyeBlinkParameterCount() > 0) {
      this._eyeBlink = CubismEyeBlink.create(setting);
    }

    // --- breath (デフォルト設定)
    {
      const breath = CubismBreath.create();
      const idManager = CubismFramework.getIdManager();
      const breathParameters: BreathParameterData[] = [
        new BreathParameterData(
          idManager.getId(CubismDefaultParameterId.ParamAngleX),
          0.0,
          15.0,
          6.5345,
          0.5
        ),
        new BreathParameterData(
          idManager.getId(CubismDefaultParameterId.ParamAngleY),
          0.0,
          8.0,
          3.5345,
          0.5
        ),
        new BreathParameterData(
          idManager.getId(CubismDefaultParameterId.ParamAngleZ),
          0.0,
          10.0,
          5.5345,
          0.5
        ),
        new BreathParameterData(
          idManager.getId(CubismDefaultParameterId.ParamBodyAngleX),
          0.0,
          4.0,
          15.5345,
          0.5
        ),
        new BreathParameterData(
          idManager.getId(CubismDefaultParameterId.ParamBreath),
          0.5,
          0.5,
          3.2345,
          1.0
        ),
      ];
      breath.setParameters(breathParameters);
      this._breath = breath;
    }

    // --- user data
    const userdataName = setting.getUserDataFile();
    if (userdataName) {
      const url = resolveAsset(userdataName);
      if (url) {
        const buf = await fetchArrayBuffer(url);
        this.loadUserData(buf, buf.byteLength);
      }
    }

    // --- eye blink parameter ids
    if (this._eyeBlink) {
      const ids: CubismIdHandle[] = [];
      for (let i = 0; i < setting.getEyeBlinkParameterCount(); i++) {
        ids.push(setting.getEyeBlinkParameterId(i));
      }
      this._eyeBlink.setParameterIds(ids);
    }

    // --- motions (全グループ、全モーションを事前ロード)
    const motionGroupCount = setting.getMotionGroupCount();
    for (let g = 0; g < motionGroupCount; g++) {
      const group = setting.getMotionGroupName(g);
      const count = setting.getMotionCount(group);
      for (let i = 0; i < count; i++) {
        const file = setting.getMotionFileName(group, i);
        const url = resolveAsset(file);
        if (!url) continue;
        const buf = await fetchArrayBuffer(url);
        const motion = this.loadMotion(
          buf,
          buf.byteLength,
          `${group}_${i}`,
          undefined,
          undefined,
          setting,
          group,
          i
        );
        if (motion) {
          this._motions.set(`${group}_${i}`, motion);
        }
      }
    }

    // CubismModelMatrix は loadModel の中で (cw, ch) + setHeight(2.0) 済み。
    // 縦長キャンバスの場合のみ setWidth(2.0) に差し替えて幅を埋める（LAppModel 標準パターン）。
    if (this._canvasWidth < this._canvasHeight) {
      this._modelMatrix.setWidth(2.0);
    }

    this.setInitialized(true);
  }

  /**
   * WebGL コンテキストとテクスチャを初期化する。
   * ロード後、Three の GL コンテキストが確定してから 1 回だけ呼ぶ。
   */
  public async initializeRendering(
    gl: WebGL2RenderingContext | WebGLRenderingContext,
    resolveAsset: (rel: string) => string | null
  ): Promise<void> {
    if (!this._setting) {
      throw new Error("CubismInstance: setting 未初期化");
    }
    this._gl = gl;

    // 描画サイズは後で setRenderState で更新されるので、ここではダミー寸法で初期化
    this.createRenderer(this._canvasWidth, this._canvasHeight, 1);
    const renderer = this.getRenderer();
    renderer.startUp(gl);
    renderer.setIsPremultipliedAlpha(true);

    // --- textures: setting.getTextureFileName(i) を fetch → Image → WebGLTexture
    const texCount = this._setting.getTextureCount();
    for (let i = 0; i < texCount; i++) {
      const texFile = this._setting.getTextureFileName(i);
      const url = resolveAsset(texFile);
      if (!url) continue;
      const glTexture = await createGLTextureFromUrl(gl, url);
      this._textures.push(glTexture);
      renderer.bindTexture(i, glTexture);
    }
  }

  /**
   * 毎フレーム呼ぶ。motion/physics/eyeblink/breath/pose/expression を進める。
   * dtMs はミリ秒（Three の delta * 1000）
   */
  public updateModel(dtMs: number): void {
    if (!this._model || !this._setting) return;
    const dtSec = dtMs / 1000;

    this._model.loadParameters();
    let motionUpdated = false;
    if (!this._motionManager.isFinished()) {
      motionUpdated = this._motionManager.updateMotion(this._model, dtSec);
    }
    this._model.saveParameters();

    // eyeblink（motion が何か書き換えた後に適用）
    if (!motionUpdated) {
      if (this._eyeBlink) {
        this._eyeBlink.updateParameters(this._model, dtSec);
      }
    }

    // expression（複数同時ブレンド可能）
    if (this._expressionManager) {
      this._expressionManager.updateMotion(this._model, dtSec);
    }

    // breath
    if (this._breath) {
      this._breath.updateParameters(this._model, dtSec);
    }

    // physics
    if (this._physics) {
      this._physics.evaluate(this._model, dtSec);
    }

    // pose
    if (this._pose) {
      this._pose.updateParameters(this._model, dtSec);
    }

    this._model.update();
  }

  /** 指定 FBO, viewport で drawModel する。MVP は内部のモデル行列を流用 */
  public drawInto(
    fbo: WebGLFramebuffer | null,
    viewport: [number, number, number, number]
  ): void {
    const renderer = this.getRenderer();
    if (!renderer) return;

    // MVP: projection × modelMatrix (LAppModel 標準パターン)
    // modelMatrix だけだと横長モデルは X が [-cw/ch, cw/ch] に広がって clip され、
    // 縦長モデルは setWidth(2.0) で Y が [-ch/cw, ch/cw] になる。
    // projection.scale でそれぞれ反対軸を縮めて NDC [-1, 1] に収める。
    const mvp = new CubismMatrix44();
    if (this._canvasWidth < this._canvasHeight) {
      // portrait
      mvp.scale(1.0, this._canvasWidth / this._canvasHeight);
    } else {
      // landscape / square
      mvp.scale(this._canvasHeight / this._canvasWidth, 1.0);
    }
    mvp.multiplyByMatrix(this._modelMatrix);
    renderer.setMvpMatrix(mvp);

    // setRenderState の型は非 null の WebGLFramebuffer だが、
    // 実装は gl.bindFramebuffer(FRAMEBUFFER, fbo) をそのまま呼ぶのみで null も有効。
    renderer.setRenderState(fbo as WebGLFramebuffer, viewport);
    renderer.drawModel();
  }

  public getCanvasWidth(): number {
    return this._canvasWidth;
  }

  public getCanvasHeight(): number {
    return this._canvasHeight;
  }

  public listMotionGroups(): MotionDefinitionInfo[] {
    if (!this._setting) return [];
    const out: MotionDefinitionInfo[] = [];
    const count = this._setting.getMotionGroupCount();
    for (let g = 0; g < count; g++) {
      const name = this._setting.getMotionGroupName(g);
      out.push({ groupName: name, motionCount: this._setting.getMotionCount(name) });
    }
    return out;
  }

  public listExpressions(): ExpressionDefinitionInfo[] {
    const out: ExpressionDefinitionInfo[] = [];
    for (const name of this._expressions.keys()) {
      out.push({ name });
    }
    return out;
  }

  public hasExpression(name: string): boolean {
    return this._expressions.has(name);
  }

  /** 指定グループの index 番のモーションを再生する */
  public startMotion(groupName: string, index: number, priority = PRIORITY_NORMAL): boolean {
    const motion = this._motions.get(`${groupName}_${index}`);
    if (!motion) return false;
    const handle = this._motionManager.startMotionPriority(motion, false, priority);
    return handle !== -1 && handle !== undefined;
  }

  public stopMotions(): void {
    this._motionManager.stopAllMotions();
  }

  public setExpression(name: string): boolean {
    const exp = this._expressions.get(name);
    if (!exp) return false;
    this._expressionManager.startMotion(exp, false);
    return true;
  }

  public resetExpression(): void {
    this._expressionManager.stopAllMotions();
  }

  /** セマンティック表情用: coreModel への直接パラメータ書き込み */
  public setParameterValue(id: string, value: number): void {
    if (!this._model) return;
    const idManager = CubismFramework.getIdManager();
    const handle = idManager.getId(id);
    this._model.setParameterValueById(handle, value);
  }

  public getParameterValue(id: string): number {
    if (!this._model) return 0;
    const idManager = CubismFramework.getIdManager();
    const handle = idManager.getId(id);
    return this._model.getParameterValueById(handle);
  }

  public disposeAll(): void {
    const gl = this._gl;
    if (gl) {
      for (const t of this._textures) {
        gl.deleteTexture(t);
      }
    }
    this._textures = [];
    this._motions.clear();
    this._expressions.clear();
    this.release();
  }
}

// ──────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────

async function createGLTextureFromUrl(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  url: string
): Promise<WebGLTexture> {
  const image = await loadImage(url);
  const tex = gl.createTexture();
  if (!tex) throw new Error("gl.createTexture failed");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    image
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}
