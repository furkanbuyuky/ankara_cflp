import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

function Tex({ src, block }: { src: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(src, { displayMode: !!block, throwOnError: false }), [src, block]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Formulation() {
  return (
    <div className="stack small" style={{ gap: 8 }}>
      <p className="ink2">
        Kümeler: <Tex src="I" /> mahalleler, <Tex src="J" /> aday yerler, <Tex src="K_j" /> <Tex src="j" />'nin arazisine sığan hastane tipleri.
        Değişkenler: <Tex src="y_{jk}\in\{0,1\}" /> <Tex src="j" />'de <Tex src="k" /> tipi açılır, <Tex src="x_{ij}\in\{0,1\}" /> mahalle <Tex src="i" />, <Tex src="j" />'ye atanır,
        <Tex src="z_i\in\{0,1\}" /> mahalle karşılanmaz.
      </p>
      <Tex block src={String.raw`\min \sum_{j}\sum_{k\in K_j} F_{jk}\,y_{jk} + \sum_{i}\sum_{j} c_{ij}\,x_{ij} + \sum_i \pi_i\, z_i`} />
      <Tex block src={String.raw`\begin{aligned}
&\textstyle\sum_j x_{ij} + z_i = 1 && \forall i \quad\text{(tek kaynak ya da karşılanmaz)}\\
&\textstyle\sum_i d_i\,x_{ij} \le \sum_{k} u_k\,y_{jk} && \forall j \quad\text{(kapasite)}\\
&\textstyle\sum_{k} y_{jk} \le 1 && \forall j \quad\text{(yer başına bir hastane)}\\
&\textstyle x_{ij} \le \sum_k y_{jk} && \forall i,j \quad\text{(güçlü bağlantı)}\\
&\textstyle\sum_{jk} u_k y_{jk} \ge \sum_i d_i (1-z_i) && \quad\text{(geçerli eşitsizlik)}
\end{aligned}`} />
      <p className="ink2">
        <Tex src="F_{jk} = (C_k + \rho_j a_k)\cdot \mathrm{CRF}" /> yıllıklandırılmış açılış maliyeti, <Tex src="c_{ij} = \alpha\, w_i\, \mathrm{dist}_{ij}" /> yıllık ulaşım maliyeti,
        <Tex src="d_i = w_i\,\beta/1000" /> yatak ihtiyacı, <Tex src="\pi_i" /> karşılanmama cezası. Opsiyonel kısıtlar: hastane sayısı
        <Tex src="\sum y \le p_{\max}" />, bütçe <Tex src="\sum I_{jk} y_{jk} \le B" />, maksimum mesafe ve minimum doluluk.
      </p>
    </div>
  );
}
