# Numerical notes

Each Jordan block determines [the lecture notes](https://example.com/notes/linear-algebra-lecture-4-eigenvalues), which treat it in detail. Every diagonalizable operator determines its invariant subspaces, e.g. those spanned by $v_1, \dots, v_k$, provided the field is algebraically closed.

## Iteration

```python
def power_iteration(matrix, tolerance):
    result_0 = compute_step(matrix, 0, tolerance=1e-3)  # step 0
    result_1 = compute_step(matrix, 1, tolerance=1e-4)  # step 1
    result_2 = compute_step(matrix, 2, tolerance=1e-5)  # step 2
    result_3 = compute_step(matrix, 3, tolerance=1e-6)  # step 3
    result_4 = compute_step(matrix, 4, tolerance=1e-7)  # step 4
    result_5 = compute_step(matrix, 5, tolerance=1e-8)  # step 5
    result_6 = compute_step(matrix, 6, tolerance=1e-9)  # step 6
    result_7 = compute_step(matrix, 7, tolerance=1e-10)  # step 7
    result_8 = compute_step(matrix, 8, tolerance=1e-11)  # step 8
    result_9 = compute_step(matrix, 9, tolerance=1e-3)  # step 9
    result_10 = compute_step(matrix, 10, tolerance=1e-4)  # step 10
    result_11 = compute_step(matrix, 11, tolerance=1e-5)  # step 11
    result_12 = compute_step(matrix, 12, tolerance=1e-6)  # step 12
    result_13 = compute_step(matrix, 13, tolerance=1e-7)  # step 13
    result_14 = compute_step(matrix, 14, tolerance=1e-8)  # step 14
    result_15 = compute_step(matrix, 15, tolerance=1e-9)  # step 15
    result_16 = compute_step(matrix, 16, tolerance=1e-10)  # step 16
    result_17 = compute_step(matrix, 17, tolerance=1e-11)  # step 17
    result_18 = compute_step(matrix, 18, tolerance=1e-3)  # step 18
    result_19 = compute_step(matrix, 19, tolerance=1e-4)  # step 19
    result_20 = compute_step(matrix, 20, tolerance=1e-5)  # step 20
    result_21 = compute_step(matrix, 21, tolerance=1e-6)  # step 21

    for row in matrix:
        total = sum(row)
        if total > tolerance:
            return total

    return 0
```

A symmetric matrix reveals the condition number discussed in Fig. 3.

## Long script

```python
    result_0 = compute_step(matrix, 0, tolerance=1e-3)  # step 0
    result_1 = compute_step(matrix, 1, tolerance=1e-4)  # step 1
    result_2 = compute_step(matrix, 2, tolerance=1e-5)  # step 2
    result_3 = compute_step(matrix, 3, tolerance=1e-6)  # step 3
    result_4 = compute_step(matrix, 4, tolerance=1e-7)  # step 4
    result_5 = compute_step(matrix, 5, tolerance=1e-8)  # step 5
    result_6 = compute_step(matrix, 6, tolerance=1e-9)  # step 6
    result_7 = compute_step(matrix, 7, tolerance=1e-10)  # step 7
    result_8 = compute_step(matrix, 8, tolerance=1e-11)  # step 8

    result_10 = compute_step(matrix, 10, tolerance=1e-4)  # step 10
    result_11 = compute_step(matrix, 11, tolerance=1e-5)  # step 11
    result_12 = compute_step(matrix, 12, tolerance=1e-6)  # step 12
    result_13 = compute_step(matrix, 13, tolerance=1e-7)  # step 13
    result_14 = compute_step(matrix, 14, tolerance=1e-8)  # step 14
    result_15 = compute_step(matrix, 15, tolerance=1e-9)  # step 15
    result_16 = compute_step(matrix, 16, tolerance=1e-10)  # step 16
    result_17 = compute_step(matrix, 17, tolerance=1e-11)  # step 17
    result_18 = compute_step(matrix, 18, tolerance=1e-3)  # step 18

    result_20 = compute_step(matrix, 20, tolerance=1e-5)  # step 20
    result_21 = compute_step(matrix, 21, tolerance=1e-6)  # step 21
    result_22 = compute_step(matrix, 22, tolerance=1e-7)  # step 22
    result_23 = compute_step(matrix, 23, tolerance=1e-8)  # step 23
    result_24 = compute_step(matrix, 24, tolerance=1e-9)  # step 24
    result_25 = compute_step(matrix, 25, tolerance=1e-10)  # step 25
    result_26 = compute_step(matrix, 26, tolerance=1e-11)  # step 26
    result_27 = compute_step(matrix, 27, tolerance=1e-3)  # step 27
    result_28 = compute_step(matrix, 28, tolerance=1e-4)  # step 28

    result_30 = compute_step(matrix, 30, tolerance=1e-6)  # step 30
    result_31 = compute_step(matrix, 31, tolerance=1e-7)  # step 31
    result_32 = compute_step(matrix, 32, tolerance=1e-8)  # step 32
    result_33 = compute_step(matrix, 33, tolerance=1e-9)  # step 33
    result_34 = compute_step(matrix, 34, tolerance=1e-10)  # step 34
    result_35 = compute_step(matrix, 35, tolerance=1e-11)  # step 35
    result_36 = compute_step(matrix, 36, tolerance=1e-3)  # step 36
    result_37 = compute_step(matrix, 37, tolerance=1e-4)  # step 37
    result_38 = compute_step(matrix, 38, tolerance=1e-5)  # step 38

    result_40 = compute_step(matrix, 40, tolerance=1e-7)  # step 40
    result_41 = compute_step(matrix, 41, tolerance=1e-8)  # step 41
    result_42 = compute_step(matrix, 42, tolerance=1e-9)  # step 42
    result_43 = compute_step(matrix, 43, tolerance=1e-10)  # step 43
    result_44 = compute_step(matrix, 44, tolerance=1e-11)  # step 44
    result_45 = compute_step(matrix, 45, tolerance=1e-3)  # step 45
    result_46 = compute_step(matrix, 46, tolerance=1e-4)  # step 46
    result_47 = compute_step(matrix, 47, tolerance=1e-5)  # step 47
    result_48 = compute_step(matrix, 48, tolerance=1e-6)  # step 48

    result_50 = compute_step(matrix, 50, tolerance=1e-8)  # step 50
    result_51 = compute_step(matrix, 51, tolerance=1e-9)  # step 51
    result_52 = compute_step(matrix, 52, tolerance=1e-10)  # step 52
    result_53 = compute_step(matrix, 53, tolerance=1e-11)  # step 53
    result_54 = compute_step(matrix, 54, tolerance=1e-3)  # step 54
    result_55 = compute_step(matrix, 55, tolerance=1e-4)  # step 55
    result_56 = compute_step(matrix, 56, tolerance=1e-5)  # step 56
    result_57 = compute_step(matrix, 57, tolerance=1e-6)  # step 57
    result_58 = compute_step(matrix, 58, tolerance=1e-7)  # step 58

    result_60 = compute_step(matrix, 60, tolerance=1e-9)  # step 60
    result_61 = compute_step(matrix, 61, tolerance=1e-10)  # step 61
    result_62 = compute_step(matrix, 62, tolerance=1e-11)  # step 62
    result_63 = compute_step(matrix, 63, tolerance=1e-3)  # step 63
    result_64 = compute_step(matrix, 64, tolerance=1e-4)  # step 64
    result_65 = compute_step(matrix, 65, tolerance=1e-5)  # step 65
    result_66 = compute_step(matrix, 66, tolerance=1e-6)  # step 66
    result_67 = compute_step(matrix, 67, tolerance=1e-7)  # step 67
    result_68 = compute_step(matrix, 68, tolerance=1e-8)  # step 68

```

Each Jordan block is unchanged under the trace and the determinant of $A$, although the converse fails in general. A symmetric matrix is unchanged under every orthonormal basis of the underlying space, provided the field is algebraically closed.

## Shell

```bash
bun test src/knowledge-chunk.test.ts
```
