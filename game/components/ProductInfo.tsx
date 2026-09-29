"use client";

import { useEffect, useRef } from "react";
import notices from "../lib/client-notices.json";

export default function ProductInfo({
  kind,
  close,
}: {
  kind: "data" | "licenses";
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const title = kind === "data" ? "그림은 어디에 저장되나요?" : "오픈소스 안내";
  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      onCancel={close}
      aria-labelledby="product-info-title"
    >
      <button className="dialog-close" onClick={close} aria-label="안내 닫기">
        ×
      </button>
      <span className="eyebrow">드로우 더비</span>
      <h2 id="product-info-title">{title}</h2>
      {kind === "data" ? (
        <>
          <section className="legal-section">
            <h3>이 기기에 저장되는 정보</h3>
            <p>
              그림, 선수 이름, 선택한 트랙은 이 브라우저 또는 앱의 저장 공간에
              남아요. 브라우저의 사이트 데이터를 지우거나 Android 설정에서 앱
              데이터를 삭제하면 함께 지워집니다.
            </p>
          </section>
          <section className="legal-section">
            <h3>친구와 경주할 때</h3>
            <p>
              방에 들어가면 선수 이름과 그림을 게임 서버에 보내고, 같은 방의
              참가자에게 보여줘요. 방 코드, 참가 식별자, 준비 상태와 경주 결과도
              함께 처리됩니다. 실명이나 연락처 등 개인정보를 이름이나 그림에
              넣지 마세요.
            </p>
          </section>
          <section className="legal-section">
            <h3>대기방과 연결 정보</h3>
            <p>
              방은 활동할 때마다 보관 시간이 연장되고, 마지막 활동 후 2시간이
              지나면 삭제됩니다. 비어 있는 방은 정리됩니다. 다시 연결하기 위한
              참가 정보는 브라우저 세션 동안 보관돼요.
            </p>
            <p>
              기본 서버는 Cloudflare를 이용합니다. 서버 접속 과정에서 IP 주소 등
              연결 정보가 처리될 수 있으며, 방 데이터의 삭제와 서버 접속 기록의
              보관은 별개입니다. Android에서 다른 서버를 선택하면 그 서버로
              정보가 전달돼요.
            </p>
          </section>
          <section className="legal-section">
            <h3>같이 즐기는 그림</h3>
            <p>
              다른 사람의 권리를 침해하거나, 불쾌감을 주는 그림과 이름은
              사용하지 마세요. 초대 코드는 함께 플레이할 사람에게만 공유해
              주세요.
            </p>
          </section>
        </>
      ) : (
        <>
          <p>
            웹 화면과 오프라인 게임에 포함된 라이브러리와 글꼴의 저작권 및
            이용허락입니다.
          </p>
          {notices.map((notice) => (
            <section className="legal-section" key={notice.name}>
              <h3>
                {notice.name} <small>{notice.version}</small>
              </h3>
              <pre className="license-text">{notice.license}</pre>
            </section>
          ))}
        </>
      )}
      <button className="button dark full" onClick={close}>
        확인했어요
      </button>
    </dialog>
  );
}
