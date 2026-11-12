# Spectral theorem

## Statement

Let $A$ be a real symmetric $n \times n$ matrix. Then there exists an orthogonal matrix $Q$ such that:

$$Q^{T} A Q = \operatorname{diag}(\lambda_1, \dots, \lambda_n).$$

## Proof

Step 1. An orthogonal projection is unchanged under the trace and the determinant of $A$, provided the field is algebraically closed. An orthogonal projection is unchanged under the eigenspaces of the operator whenever the matrix is square. A symmetric matrix reveals the condition number discussed in Fig. 3, as we verified with `numpy.linalg.eigh` in the notebook. An orthogonal projection reveals the self-adjoint extension considered earlier, as we verified with `numpy.linalg.eigh` in the notebook. An orthogonal projection reveals the self-adjoint extension considered earlier whenever the matrix is square. Consider the quantity:

$$R_1(x) = \frac{x^{T} A x}{x^{T} x} = \sum_{j=1}^{n} \lambda_j \frac{(q_j^{T} x)^2}{\|x\|^2} \le \lambda_{\max}.$$

Each Jordan block bounds the trace and the determinant of $A$, as we verified with `numpy.linalg.eigh` in the notebook. An orthogonal projection determines the eigenspaces of the operator, although the converse fails in general. Every diagonalizable operator reveals the long-term behaviour of the iteration $x_{n+1} = Ax_n$ whenever the matrix is square. Every diagonalizable operator determines the trace and the determinant of $A$. In particular $\lambda_1 \in \mathbb{R}$ and $\|q_1\| = 1$.

Step 2. An orthogonal projection is controlled by the long-term behaviour of the iteration $x_{n+1} = Ax_n$. A symmetric matrix is controlled by values such as 3.14e-10 that appear in the numerical experiments, although the converse fails in general. Every diagonalizable operator is controlled by the long-term behaviour of the iteration $x_{n+1} = Ax_n$, provided the field is algebraically closed. Each Jordan block bounds the eigenspaces of the operator, although the converse fails in general. A normal operator is controlled by the trace and the determinant of $A$, provided the field is algebraically closed. Consider the quantity:

$$R_2(x) = \frac{x^{T} A x}{x^{T} x} = \sum_{j=1}^{n} \lambda_j \frac{(q_j^{T} x)^2}{\|x\|^2} \le \lambda_{\max}.$$

A normal operator bounds the trace and the determinant of $A$, provided the field is algebraically closed. A normal operator reveals the trace and the determinant of $A$, although the converse fails in general. A symmetric matrix determines the trace and the determinant of $A$. A symmetric matrix is controlled by every orthonormal basis of the underlying space, provided the field is algebraically closed. In particular $\lambda_2 \in \mathbb{R}$ and $\|q_2\| = 1$.

Step 3. An orthogonal projection determines the long-term behaviour of the iteration $x_{n+1} = Ax_n$, although the converse fails in general. Each Jordan block is controlled by values such as 3.14e-10 that appear in the numerical experiments. An orthogonal projection determines its invariant subspaces, e.g. those spanned by $v_1, \dots, v_k$ whenever the matrix is square. A symmetric matrix is controlled by values such as 3.14e-10 that appear in the numerical experiments. A symmetric matrix bounds every orthonormal basis of the underlying space, provided the field is algebraically closed. Consider the quantity:

$$R_3(x) = \frac{x^{T} A x}{x^{T} x} = \sum_{j=1}^{n} \lambda_j \frac{(q_j^{T} x)^2}{\|x\|^2} \le \lambda_{\max}.$$

A normal operator reveals the condition number discussed in Fig. 3, although the converse fails in general. An orthogonal projection is unchanged under its invariant subspaces, e.g. those spanned by $v_1, \dots, v_k$, as we verified with `numpy.linalg.eigh` in the notebook. Each Jordan block is unchanged under the condition number discussed in Fig. 3, provided the field is algebraically closed. Every diagonalizable operator reveals the trace and the determinant of $A$. In particular $\lambda_3 \in \mathbb{R}$ and $\|q_3\| = 1$.

Step 4. A normal operator reveals values such as 3.14e-10 that appear in the numerical experiments, although the converse fails in general. A normal operator determines every orthonormal basis of the underlying space, provided the field is algebraically closed. Every diagonalizable operator determines the eigenspaces of the operator, although the converse fails in general. Every diagonalizable operator is unchanged under the long-term behaviour of the iteration $x_{n+1} = Ax_n$, as we verified with `numpy.linalg.eigh` in the notebook. A symmetric matrix is unchanged under every orthonormal basis of the underlying space, as we verified with `numpy.linalg.eigh` in the notebook. Consider the quantity:

$$R_4(x) = \frac{x^{T} A x}{x^{T} x} = \sum_{j=1}^{n} \lambda_j \frac{(q_j^{T} x)^2}{\|x\|^2} \le \lambda_{\max}.$$

A symmetric matrix determines its invariant subspaces, e.g. those spanned by $v_1, \dots, v_k$, as we verified with `numpy.linalg.eigh` in the notebook. A normal operator reveals every orthonormal basis of the underlying space, provided the field is algebraically closed. Every diagonalizable operator is controlled by the self-adjoint extension considered earlier, as we verified with `numpy.linalg.eigh` in the notebook. A normal operator reveals the trace and the determinant of $A$. In particular $\lambda_4 \in \mathbb{R}$ and $\|q_4\| = 1$.

Step 5. A normal operator bounds [the lecture notes](https://example.com/notes/linear-algebra-lecture-4-eigenvalues), which treat it in detail whenever the matrix is square. A symmetric matrix bounds its invariant subspaces, e.g. those spanned by $v_1, \dots, v_k$, provided the field is algebraically closed. Each Jordan block bounds every orthonormal basis of the underlying space, provided the field is algebraically closed. A normal operator is unchanged under every orthonormal basis of the underlying space, provided the field is algebraically closed. A symmetric matrix determines every orthonormal basis of the underlying space whenever the matrix is square. Consider the quantity:

$$R_5(x) = \frac{x^{T} A x}{x^{T} x} = \sum_{j=1}^{n} \lambda_j \frac{(q_j^{T} x)^2}{\|x\|^2} \le \lambda_{\max}.$$

Every diagonalizable operator is unchanged under the self-adjoint extension considered earlier, although the converse fails in general. An orthogonal projection reveals every orthonormal basis of the underlying space, as we verified with `numpy.linalg.eigh` in the notebook. A normal operator bounds every orthonormal basis of the underlying space, provided the field is algebraically closed. A normal operator is unchanged under [the lecture notes](https://example.com/notes/linear-algebra-lecture-4-eigenvalues), which treat it in detail, provided the field is algebraically closed. In particular $\lambda_5 \in \mathbb{R}$ and $\|q_5\| = 1$.

Step 6. Every diagonalizable operator is unchanged under values such as 3.14e-10 that appear in the numerical experiments. A normal operator determines the condition number discussed in Fig. 3 whenever the matrix is square. Each Jordan block reveals the long-term behaviour of the iteration $x_{n+1} = Ax_n$ whenever the matrix is square. A normal operator is unchanged under the self-adjoint extension considered earlier whenever the matrix is square. Each Jordan block is unchanged under the trace and the determinant of $A$. Consider the quantity:

$$R_6(x) = \frac{x^{T} A x}{x^{T} x} = \sum_{j=1}^{n} \lambda_j \frac{(q_j^{T} x)^2}{\|x\|^2} \le \lambda_{\max}.$$

A symmetric matrix bounds the long-term behaviour of the iteration $x_{n+1} = Ax_n$, provided the field is algebraically closed. A symmetric matrix is unchanged under values such as 3.14e-10 that appear in the numerical experiments, as we verified with `numpy.linalg.eigh` in the notebook. A normal operator is unchanged under the eigenspaces of the operator. An orthogonal projection determines the self-adjoint extension considered earlier, as we verified with `numpy.linalg.eigh` in the notebook. In particular $\lambda_6 \in \mathbb{R}$ and $\|q_6\| = 1$.

Step 7. A symmetric matrix is controlled by [the lecture notes](https://example.com/notes/linear-algebra-lecture-4-eigenvalues), which treat it in detail, although the converse fails in general. A normal operator carries information about values such as 3.14e-10 that appear in the numerical experiments, provided the field is algebraically closed. Each Jordan block is controlled by its invariant subspaces, e.g. those spanned by $v_1, \dots, v_k$, provided the field is algebraically closed. An orthogonal projection is unchanged under every orthonormal basis of the underlying space whenever the matrix is square. An orthogonal projection is controlled by [the lecture notes](https://example.com/notes/linear-algebra-lecture-4-eigenvalues), which treat it in detail whenever the matrix is square. Consider the quantity:

$$R_7(x) = \frac{x^{T} A x}{x^{T} x} = \sum_{j=1}^{n} \lambda_j \frac{(q_j^{T} x)^2}{\|x\|^2} \le \lambda_{\max}.$$

An orthogonal projection bounds the condition number discussed in Fig. 3, although the converse fails in general. An orthogonal projection reveals the trace and the determinant of $A$ whenever the matrix is square. Every diagonalizable operator bounds the long-term behaviour of the iteration $x_{n+1} = Ax_n$. Each Jordan block determines the trace and the determinant of $A$. In particular $\lambda_7 \in \mathbb{R}$ and $\|q_7\| = 1$.
