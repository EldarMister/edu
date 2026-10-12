declare module 'qrcode' {
  const QRCode: {
    create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): {
      modules: { size: number; get(row: number, column: number): boolean | number };
    };
  };
  export default QRCode;
}
